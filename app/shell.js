const readline = require('readline');
const { createBuiltins } = require('./builtins');
const { createCompletion } = require('./completion');
const { BUILT_INS } = require('./constants');
const { createExecutor } = require('./executor');
const { createHistory } = require('./history');
const { createJobs } = require('./jobs');
const { createRedirectionFile, writeOutput } = require('./io');
const { extractRedirection, parseCommandLine, splitPipeline } = require('./parser');
const { createVariables } = require('./variables');

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

  const prompt = () => {
    if (!isReadlineClosed) {
      jobs.reapDoneJobs(null, 'write');
      rl.prompt();
    }
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

    createRedirectionFile(stdoutFile, stdoutMode);
    createRedirectionFile(stderrFile, stderrMode);

    if (commandName === 'type') {
      handleType(commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
      prompt();
      return;
    }

    if (BUILT_INS.includes(commandName)) {
      await builtinHandlers.handleCommand(commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
      prompt();
      return;
    }

    const executablePath = executor.findExecutable(commandName);

    if (executablePath === null) {
      writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
      prompt();
      return;
    }

    const child = await executor.runExternalCommand(
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
    }

    prompt();
  };

  const start = () => {
    history.loadHistoryFromEnvironment();

    rl.on('close', () => {
      isReadlineClosed = true;
    });

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

module.exports = {
  createShell,
};
