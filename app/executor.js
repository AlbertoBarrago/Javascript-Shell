import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { closeFileDescriptor } from './io.js';

/**
 * Create the command executor: PATH lookup, external command execution and
 * pipeline handling.
 *
 * @param {string[]} builtIns - Names of the shell builtins.
 * @param {(commandName: string, commandArgs: string[]) => string} getBuiltinOutput
 *   Callback returning a builtin's captured stdout, used inside pipelines.
 * @returns {{
 *   findExecutable: (commandName: string) => string|null,
 *   runExternalCommand: Function,
 *   runPipeline: (commands: string[][]) => Promise<void>
 * }} The executor API.
 */
const createExecutor = (builtIns, getBuiltinOutput) => {
  /**
   * Resolve a command name to an executable path by scanning `PATH`.
   *
   * @param {string} commandName - The command to look up.
   * @returns {string|null} The absolute path, or `null` if not found.
   */
  const findExecutable = (commandName) => {
    const paths = (process.env.PATH || '').split(path.delimiter);

    for (const directory of paths) {
      const executablePath = path.join(directory, commandName);

      try {
        fs.accessSync(executablePath, fs.constants.X_OK);
        return executablePath;
      } catch {
        // Try the next PATH entry.
      }
    }

    return null;
  };

  /**
   * Spawn an external command, applying stdout/stderr redirection.
   *
   * @param {string} commandPath - Absolute path to the executable.
   * @param {string} commandName - Name to expose as argv0.
   * @param {string[]} commandArgs - Arguments passed to the command.
   * @param {import('./parser.js').RedirectionTarget[]} stdoutTargets - stdout targets.
   * @param {import('./parser.js').RedirectionTarget[]} stderrTargets - stderr targets.
   * @param {boolean} isBackground - Whether to run detached in the background.
   * @returns {Promise<import('node:child_process').ChildProcess|{exitCode: number}>}
   *   The child process when backgrounded, otherwise the foreground exit code.
   */
  const runExternalCommand = (
    commandPath,
    commandName,
    commandArgs,
    stdoutTargets,
    stderrTargets,
    isBackground,
  ) => {
    return new Promise((resolve) => {
      // Prepare a stream's stdio value. With no target it inherits the parent
      // stream; with a single target it maps to a direct fd (zero-copy); with
      // several targets it becomes a pipe so we can fan the output out to every
      // file (tee-style multiwrite).
      const prepareStream = (targets, inherited) => {
        if (targets.length === 0) {
          return { stdio: inherited, fds: [], pipe: false };
        }

        const fds = targets.map(({ file, mode }) =>
          fs.openSync(file, mode === 'append' ? 'a' : 'w'),
        );

        if (fds.length === 1) {
          return { stdio: fds[0], fds, pipe: false };
        }

        return { stdio: 'pipe', fds, pipe: true };
      };

      const stdout = prepareStream(stdoutTargets, 'inherit');
      const stderr = prepareStream(stderrTargets, 'inherit');
      const stdio = ['inherit', stdout.stdio, stderr.stdio];

      const child = spawn(commandPath, commandArgs, {
        argv0: commandName,
        stdio,
      });

      // Fan a piped child stream out to each of its target descriptors.
      const fanOut = (stream, fds) => {
        if (stream === null) {
          return;
        }

        stream.on('data', (chunk) => {
          for (const fd of fds) {
            fs.writeSync(fd, chunk);
          }
        });
      };

      if (stdout.pipe) {
        fanOut(child.stdout, stdout.fds);
      }

      if (stderr.pipe) {
        fanOut(child.stderr, stderr.fds);
      }

      // Direct fds are owned by the child and can be released by the parent as
      // soon as it has been spawned. Fan-out fds are written to by the parent,
      // so they must stay open until the child's output stream ends.
      const directFds = [...(stdout.pipe ? [] : stdout.fds), ...(stderr.pipe ? [] : stderr.fds)];
      const fanOutFds = [...(stdout.pipe ? stdout.fds : []), ...(stderr.pipe ? stderr.fds : [])];

      const closeFds = (fds) => {
        for (const fd of fds) {
          closeFileDescriptor(fd);
        }
      };

      if (isBackground) {
        closeFds(directFds);
        child.on('close', () => closeFds(fanOutFds));
        resolve(child);
        return;
      }

      child.on('error', () => {
        closeFds([...directFds, ...fanOutFds]);
        resolve({ exitCode: 127 });
      });
      child.on('close', (code) => {
        closeFds([...directFds, ...fanOutFds]);
        resolve({ exitCode: code ?? 0 });
      });
    });
  };

  /**
   * Run a single pipeline stage and capture its stdout as a string. Used for
   * pipelines that contain at least one builtin, where OS-level piping is not
   * possible.
   *
   * @param {string[]} command - The command tokens for this stage.
   * @param {string} input - stdin content produced by the previous stage.
   * @returns {Promise<string>} The captured stdout.
   */
  const collectCommandOutput = (command, input) => {
    return new Promise((resolve) => {
      const commandName = command[0];
      const commandArgs = command.slice(1);

      if (builtIns.includes(commandName)) {
        resolve(getBuiltinOutput(commandName, commandArgs));
        return;
      }

      const commandPath = findExecutable(commandName);

      if (commandPath === null) {
        console.log(`${commandName}: command not found`);
        resolve('');
        return;
      }

      const stdin = input === '' ? 'ignore' : 'pipe';
      const child = spawn(commandPath, commandArgs, {
        argv0: commandName,
        stdio: [stdin, 'pipe', 'inherit'],
      });
      let output = '';

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });

      child.on('close', () => {
        resolve(output);
      });

      child.on('error', () => {
        resolve('');
      });

      if (input !== '') {
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      }
    });
  };

  /**
   * Run a pipeline made entirely of external commands, wiring each child's
   * stdout to the next child's stdin with real OS pipes.
   *
   * @param {string[][]} commands - One token array per pipeline stage.
   * @returns {Promise<void>} Resolves when the last stage exits.
   */
  const runExternalPipeline = (commands) => {
    return new Promise((resolve) => {
      const commandPaths = [];

      for (const command of commands) {
        const commandPath = findExecutable(command[0]);

        if (commandPath === null) {
          console.log(`${command[0]}: command not found`);
          resolve();
          return;
        }

        commandPaths.push(commandPath);
      }

      const children = commands.map((command, index) => {
        const isFirst = index === 0;
        const isLast = index === commands.length - 1;

        return spawn(commandPaths[index], command.slice(1), {
          argv0: command[0],
          stdio: [isFirst ? 'inherit' : 'pipe', isLast ? 'inherit' : 'pipe', 'inherit'],
        });
      });

      for (let index = 0; index < children.length - 1; index++) {
        children[index].stdout.pipe(children[index + 1].stdin);
        children[index + 1].stdin.on('error', () => {});
      }

      const lastChild = children[children.length - 1];

      lastChild.on('close', () => {
        for (const child of children.slice(0, -1)) {
          if (!child.killed) {
            child.kill();
          }
        }

        resolve();
      });

      lastChild.on('error', () => {
        for (const child of children.slice(0, -1)) {
          if (!child.killed) {
            child.kill();
          }
        }

        resolve();
      });
    });
  };

  /**
   * Run a pipeline, choosing the all-external streaming strategy or the
   * builtin-aware string-buffering strategy depending on the stages.
   *
   * @param {string[][]} commands - One token array per pipeline stage.
   * @returns {Promise<void>} Resolves when the pipeline completes.
   */
  const runPipeline = async (commands) => {
    const hasBuiltin = commands.some((command) => builtIns.includes(command[0]));

    if (!hasBuiltin) {
      await runExternalPipeline(commands);
      return;
    }

    let output = '';

    for (const command of commands) {
      output = await collectCommandOutput(command, output);
    }

    if (output !== '') {
      process.stdout.write(output);
    }
  };

  return {
    findExecutable,
    runExternalCommand,
    runPipeline,
  };
};

export { createExecutor };
