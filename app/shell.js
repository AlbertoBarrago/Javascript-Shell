import readline from 'node:readline';

import { createBuiltins } from './builtins.js';
import { createCompletion } from './completion.js';
import { BUILT_INS } from './constants.js';
import { createExecutor } from './executor.js';
import { createHistory } from './history.js';
import { createJobs } from './jobs.js';
import { createRedirectionFile, writeOutput } from './io.js';
import { extractRedirection, parseCommandLine, splitPipeline } from './parser.js';
import { createVariables } from './variables.js';
import { colorize, stripAnsi, supportsColor } from './colors.js';

const createShell = () => {
  const history = createHistory();
  const jobs = createJobs(writeOutput);
  const variables = createVariables();
  const completion = createCompletion(BUILT_INS);
  let builtinHandlers;

  const executor = createExecutor(BUILT_INS, (commandName, commandArgs) => {
    return builtinHandlers.getBuiltinOutput(commandName, commandArgs);
  });

  builtinHandlers = createBuiltins({
    appendHistoryFile: history.appendHistoryFile,
    backgroundJobs: jobs.backgroundJobs,
    builtIns: BUILT_INS,
    completionSpecs: completion.completionSpecs,
    findExecutable: executor.findExecutable,
    isValidShellIdentifier: variables.isValidShellIdentifier,
    printHistory: history.printHistory,
    printJobs: jobs.printJobs,
    readHistoryFile: history.readHistoryFile,
    saveHistoryToEnvironment: history.saveHistoryToEnvironment,
    shellVariables: variables.shellVariables,
    waitForBackgroundJobEvents: jobs.waitForBackgroundJobEvents,
    writeHistoryFile: history.writeHistoryFile,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '$ ',
    completer: completion.completeCommand,
  });

  let pendingCommand = Promise.resolve();
  let isReadlineClosed = false;
  let lastExitCode = 0;

  /**
   * Build the interactive prompt. When colors are supported, the current
   * working directory is highlighted and the trailing symbol reflects the
   * previous command's exit status (green on success, red on failure).
   *
   * @returns {string} The prompt string, possibly containing ANSI codes.
   */
  const buildPrompt = () => {
    const colorsEnabled = supportsColor();

    if (!colorsEnabled) {
      return '$ ';
    }

    const workingDirectory = colorize(process.cwd(), 'cyan', colorsEnabled);
    const symbolColor = lastExitCode === 0 ? 'green' : 'red';
    const symbol = colorize('$', symbolColor, colorsEnabled);

    return `${workingDirectory} ${symbol} `;
  };

  const prompt = () => {
    if (!isReadlineClosed) {
      jobs.reapDoneJobs(null, 'write');
      rl.setPrompt(buildPrompt());
      rl.prompt();
    }
  };

  /**
   * Colorize the command word (first token) of an input line to signal
   * whether it resolves to a builtin (green), an external executable in PATH
   * (cyan), or nothing (red). Arguments after the command are left untouched.
   *
   * @param {string} line - Raw input line.
   * @returns {string} The line with the command token colorized.
   */
  const highlightCommandLine = (line) => {
    const match = line.match(/^(\s*)(\S+)([\s\S]*)$/);

    if (match === null) {
      return line;
    }

    const [, leadingWhitespace, commandToken, rest] = match;
    let color;

    if (BUILT_INS.includes(commandToken)) {
      color = 'green';
    } else if (executor.findExecutable(commandToken) !== null) {
      color = 'cyan';
    } else {
      color = 'red';
    }

    return `${leadingWhitespace}${colorize(commandToken, color, true)}${rest}`;
  };

  /**
   * Redraw the current input line with the command token colorized, keeping
   * the cursor at its logical position. Only runs on a color-capable TTY.
   */
  const refreshHighlightedLine = () => {
    if (isReadlineClosed || !supportsColor()) {
      return;
    }

    const promptWidth = stripAnsi(rl._prompt).length;

    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${rl._prompt}${highlightCommandLine(rl.line)}`);
    readline.cursorTo(process.stdout, promptWidth + rl.cursor);
  };

  const handleType = (commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
    if (commandArgs.length === 0) {
      console.log('type: missing operand');
      return;
    }

    if (BUILT_INS.includes(commandArgs[0])) {
      writeOutput(`${commandArgs[0]} is a shell builtin`, stdoutFile, stdoutMode);
      return;
    }

    const executablePath = executor.findExecutable(commandArgs[0]);

    if (executablePath === null) {
      writeOutput(`${commandArgs[0]}: not found`, stderrFile, stderrMode);
    } else {
      writeOutput(`${commandArgs[0]} is ${executablePath}`, stdoutFile, stdoutMode);
    }
  };

  const handleLine = async (command) => {
    completion.resetCompletionState();

    const trimmedCommand = command.trim();

    if (trimmedCommand === '') {
      prompt();
      return;
    }

    history.commandHistory.push(trimmedCommand);

    const args = variables.expandParameters(parseCommandLine(trimmedCommand));
    const pipeline = splitPipeline(args);

    if (pipeline !== null) {
      await executor.runPipeline(pipeline);
      prompt();
      return;
    }

    const commandName = args[0];
    const {
      args: commandArgs,
      stdoutFile,
      stdoutMode,
      stderrFile,
      stderrMode,
    } = extractRedirection(args.slice(1));
    const isBackground = commandArgs[commandArgs.length - 1] === '&';

    if (isBackground) {
      commandArgs.pop();
    }

    if (commandName === 'type') {
      handleType(commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
      prompt();
      return;
    }

    if (BUILT_INS.includes(commandName)) {
      createRedirectionFile(stdoutFile, stdoutMode);
      createRedirectionFile(stderrFile, stderrMode);
      await builtinHandlers.handleCommand(commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
      lastExitCode = 0;
      prompt();
      return;
    }

    const executablePath = executor.findExecutable(commandName);

    if (executablePath === null) {
      writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
      lastExitCode = 127;
      prompt();
      return;
    }

    createRedirectionFile(stdoutFile, stdoutMode);
    createRedirectionFile(stderrFile, stderrMode);

    const result = await executor.runExternalCommand(
      executablePath,
      commandName,
      commandArgs,
      stdoutFile,
      stdoutMode,
      stderrFile,
      stderrMode,
      isBackground,
    );

    if (isBackground) {
      const child = result;
      const job = {
        id: jobs.getNextJobId(),
        pid: child.pid,
        command: [commandName, ...commandArgs].join(' '),
        status: 'Running',
      };

      child.on('close', () => {
        job.status = 'Done';
      });

      jobs.backgroundJobs.push(job);
      console.log(`[${job.id}] ${job.pid}`);
    } else {
      lastExitCode = result.exitCode;
    }

    prompt();
  };

  const start = () => {
    history.loadHistoryFromEnvironment();

    rl.on('close', () => {
      isReadlineClosed = true;
    });

    if (supportsColor() && process.stdin.isTTY) {
      process.stdin.on('keypress', (_str, key) => {
        // Let readline own the rendering for keys that move away from plain
        // editing (submit and completion), then recolor on the next keystroke.
        if (key && (key.name === 'return' || key.name === 'enter' || key.name === 'tab')) {
          return;
        }

        refreshHighlightedLine();
      });
    }

    prompt();

    rl.on('line', (command) => {
      pendingCommand = pendingCommand.then(() => handleLine(command));
    });
  };

  return {
    handleLine,
    start,
  };
};

export default createShell;
