import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { closeFileDescriptor } from './io.js';

const createExecutor = (builtIns, getBuiltinOutput) => {
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

  const runExternalCommand = (
    commandPath,
    commandName,
    commandArgs,
    stdoutFile,
    stdoutMode,
    stderrFile,
    stderrMode,
    isBackground,
  ) => {
    return new Promise((resolve) => {
      const stdout = stdoutFile === null
        ? 'inherit'
        : fs.openSync(stdoutFile, stdoutMode === 'append' ? 'a' : 'w');
      const stderr = stderrFile === null
        ? 'inherit'
        : fs.openSync(stderrFile, stderrMode === 'append' ? 'a' : 'w');
      const stdio = ['inherit', stdout, stderr];

      const child = spawn(commandPath, commandArgs, {
        argv0: commandName,
        stdio,
      });

      if (isBackground) {
        closeFileDescriptor(stdout);
        closeFileDescriptor(stderr);
        resolve(child);
        return;
      }

      child.on('error', () => resolve({ exitCode: 127 }));
      child.on('close', (code) => {
        closeFileDescriptor(stdout);
        closeFileDescriptor(stderr);
        resolve({ exitCode: code ?? 0 });
      });
    });
  };

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
          stdio: [
            isFirst ? 'inherit' : 'pipe',
            isLast ? 'inherit' : 'pipe',
            'inherit',
          ],
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

  const runPipeline = (commands) => {
    return new Promise(async (resolve) => {
      const hasBuiltin = commands.some((command) => builtIns.includes(command[0]));

      if (!hasBuiltin) {
        await runExternalPipeline(commands);
        resolve();
        return;
      }

      let output = '';

      for (const command of commands) {
        output = await collectCommandOutput(command, output);
      }

      if (output !== '') {
        process.stdout.write(output);
      }

      resolve();
    });
  };

  return {
    findExecutable,
    runExternalCommand,
    runPipeline,
  };
};

export {
  createExecutor,
};
