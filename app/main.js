const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const BUILT_INS = ['type', 'echo', 'cd', 'exit', 'pwd', 'complete', 'jobs', 'history'];
const REDIRECTION_OPERATORS = ['>', '1>', '2>', '>>', '1>>', '2>>'];
const completionSpecs = new Map();
const backgroundJobs = [];
const commandHistory = [];

// Tracks the previous completion prefix and whether it had multiple matches.
let previousCompletionPrefix = null;
// Tracks whether the previous completion had multiple matches.
let previousCompletionHadMultipleMatches = false;

// Get the list of commands from the PATH environment variable
const getPathCommands = () => {
  const commands = new Set();
  const paths = (process.env.PATH || '').split(path.delimiter);

  for (const directory of paths) {
    try {
      for (const fileName of fs.readdirSync(directory)) {
        const executablePath = path.join(directory, fileName);

        try {
          fs.accessSync(executablePath, fs.constants.X_OK);
          commands.add(fileName);
        } catch {
          // Ignore non-executable files.
        }
      }
    } catch {
      // Ignore PATH entries that cannot be read.
    }
  }

  return [...commands];
};
// Find the longest common prefix among the given values.
const findLongestCommonPrefix = (values) => {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0];

  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
};
// Complete the line from the given candidates.
const completeFromCandidates = (line, replacementStart, prefix, candidates) => {
  const matches = candidates
    .filter((candidate) => candidate.startsWith(prefix))
    .sort();
  const lineBeforeReplacement = line.slice(0, replacementStart);

  if (matches.length === 1) {
    previousCompletionPrefix = null;
    previousCompletionHadMultipleMatches = false;
    const completedToken = matches[0].endsWith('/')
      ? matches[0]
      : `${matches[0]} `;
    return [[`${lineBeforeReplacement}${completedToken}`], line];
  }

  if (matches.length === 0) {
    previousCompletionPrefix = null;
    previousCompletionHadMultipleMatches = false;
    process.stdout.write('\x07');
    return [[], line];
  }

  const commonPrefix = findLongestCommonPrefix(matches);

  if (commonPrefix.length > prefix.length) {
    previousCompletionPrefix = null;
    previousCompletionHadMultipleMatches = false;
    return [[`${lineBeforeReplacement}${commonPrefix}`], line];
  }

  if (
    previousCompletionPrefix === line
    && previousCompletionHadMultipleMatches
  ) {
    process.stdout.write(`\n${matches.join('  ')}\n$ ${line}`);
    previousCompletionPrefix = null;
    previousCompletionHadMultipleMatches = false;
    return [[], line];
  }

  previousCompletionPrefix = line;
  previousCompletionHadMultipleMatches = true;
  process.stdout.write('\x07');
  return [[], line];
};
// Get the file completion candidates for the given prefix.
const getFileCompletionCandidates = (prefix) => {
  const lastSlashIndex = prefix.lastIndexOf('/');
  const directoryPrefix = lastSlashIndex === -1
    ? ''
    : prefix.slice(0, lastSlashIndex + 1);
  const fileNamePrefix = lastSlashIndex === -1
    ? prefix
    : prefix.slice(lastSlashIndex + 1);
  const directoryPath = directoryPrefix === '' ? process.cwd() : directoryPrefix;

  try {
    return fs.readdirSync(directoryPath)
      .filter((fileName) => fileName.startsWith(fileNamePrefix))
      .map((fileName) => {
        const fullPath = path.join(directoryPath, fileName);
        const completedPath = `${directoryPrefix}${fileName}`;

        try {
          return fs.statSync(fullPath).isDirectory()
            ? `${completedPath}/`
            : completedPath;
        } catch {
          return completedPath;
        }
      });
  } catch {
    return [];
  }
};
// Get the registered completion candidates for the given command and prefix.
const getRegisteredCompletionCandidates = (commandName, currentWord, previousWord, line) => {
  const completerPath = completionSpecs.get(commandName);

  if (completerPath === undefined) {
    return null;
  }

  const result = spawnSync(completerPath, [commandName, currentWord, previousWord], {
    encoding: 'utf8',
    env: {
      ...process.env,
      COMP_LINE: line,
      COMP_POINT: String(Buffer.byteLength(line)),
    },
  });

  if (result.error) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '');
};
// Handle tab completion for commands
const completeCommand = (line) => {
  const lastSpaceIndex = line.lastIndexOf(' ');

  if (lastSpaceIndex === -1) {
    const candidates = [...new Set([...BUILT_INS, ...getPathCommands()])];
    return completeFromCandidates(line, 0, line, candidates);
  }

  const commandName = line.slice(0, line.indexOf(' '));
  const prefix = line.slice(lastSpaceIndex + 1);
  const words = line.split(' ');
  const previousWord = words.length >= 2 ? words[words.length - 2] : '';
  const registeredCandidates = getRegisteredCompletionCandidates(commandName, prefix, previousWord, line);

  if (registeredCandidates !== null) {
    return completeFromCandidates(line, lastSpaceIndex + 1, prefix, registeredCandidates);
  }

  const candidates = getFileCompletionCandidates(prefix);

  return completeFromCandidates(line, lastSpaceIndex + 1, prefix, candidates);
};
// Prepare the readline interface for user input.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: completeCommand,
});
// Prompt the user for input.
const prompt = () => {
  if (!isReadlineClosed) {
    reapDoneJobs(null, 'write');
    rl.prompt();
  }
};
// Find the executable for the given command name
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
// Write the output to the console or a file
const writeOutput = (message, outputFile, outputMode = 'write') => {
  if (outputFile === null) {
    console.log(message);
    return;
  }

  fs.writeFileSync(outputFile, `${message}\n`, {
    flag: outputMode === 'append' ? 'a' : 'w',
  });
};
// Print the list of background jobs to the console or a file.
const printJobs = (stdoutFile, stdoutMode) => {
  const mostRecentJobIndex = backgroundJobs.length - 1;
  const previousJobIndex = backgroundJobs.length - 2;
  const lines = [];

  for (const [index, job] of backgroundJobs.entries()) {
    const marker = index === mostRecentJobIndex
      ? '+'
      : index === previousJobIndex
        ? '-'
        : ' ';
    const command = job.status === 'Running' ? `${job.command} &` : job.command;
    lines.push(`[${job.id}]${marker}  ${job.status.padEnd(24, ' ')}${command}`);
  }

  if (lines.length > 0) {
    writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
  }

  for (let index = backgroundJobs.length - 1; index >= 0; index--) {
    if (backgroundJobs[index].status === 'Done') {
      backgroundJobs.splice(index, 1);
    }
  }
};

// Print previously executed commands.
const printHistory = (limit, stdoutFile, stdoutMode) => {
  const startIndex = limit === null
    ? 0
    : Math.max(commandHistory.length - limit, 0);
  const lines = commandHistory.slice(startIndex).map((command, index) => {
    return `${String(startIndex + index + 1).padStart(5, ' ')}  ${command}`;
  });

  if (lines.length > 0) {
    writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
  }
};

// Append commands from a history file to the in-memory history.
const readHistoryFile = (historyFilePath) => {
  const fileContent = fs.readFileSync(historyFilePath, 'utf8');
  const commands = fileContent
    .split(/\r?\n/)
    .filter((command) => command !== '');

  commandHistory.push(...commands);
};

// Write the in-memory history to a history file.
const writeHistoryFile = (historyFilePath) => {
  fs.writeFileSync(historyFilePath, `${commandHistory.join('\n')}\n`);
};
// Get the next available job ID for a background job.
const getNextJobId = () => {
  if (backgroundJobs.length === 0) {
    return 1;
  }

  return Math.max(...backgroundJobs.map((job) => job.id)) + 1;
};
// Reap any done background jobs and write their output to the terminal.
const reapDoneJobs = (stdoutFile, stdoutMode) => {
  const mostRecentJobIndex = backgroundJobs.length - 1;
  const previousJobIndex = backgroundJobs.length - 2;
  const lines = [];

  for (const [index, job] of backgroundJobs.entries()) {
    if (job.status !== 'Done') {
      continue;
    }

    const marker = index === mostRecentJobIndex
      ? '+'
      : index === previousJobIndex
        ? '-'
        : ' ';
    lines.push(`[${job.id}]${marker}  ${job.status.padEnd(24, ' ')}${job.command}`);
  }

  if (lines.length > 0) {
    writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
  }

  for (let index = backgroundJobs.length - 1; index >= 0; index--) {
    if (backgroundJobs[index].status === 'Done') {
      backgroundJobs.splice(index, 1);
    }
  }
};

// Let pending background job close events update the job table.
const waitForBackgroundJobEvents = () => {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
};

// Create an empty file at the given path
const createRedirectionFile = (filePath, outputMode) => {
  if (filePath !== null) {
    fs.closeSync(fs.openSync(filePath, outputMode === 'append' ? 'a' : 'w'));
  }
};
// Extract redirection operators from the command arguments
const extractRedirection = (commandArgs) => {
  const redirections = {
    stdoutFile: null,
    stdoutMode: 'write',
    stderrFile: null,
    stderrMode: 'write',
  };
  const args = [];

  for (let index = 0; index < commandArgs.length; index++) {
    const arg = commandArgs[index];

    if (REDIRECTION_OPERATORS.includes(arg)) {
      const targetFile = commandArgs[index + 1] || null;
      const outputMode = arg.endsWith('>>') ? 'append' : 'write';

      if (arg === '2>' || arg === '2>>') {
        redirections.stderrFile = targetFile;
        redirections.stderrMode = outputMode;
      } else {
        redirections.stdoutFile = targetFile;
        redirections.stdoutMode = outputMode;
      }

      index++;
      continue;
    }

    args.push(arg);
  }

  return {
    args,
    ...redirections,
  };
};
// Run an external command with the given path, name, and arguments
const closeFileDescriptor = (fileDescriptor) => {
  if (typeof fileDescriptor === 'number') {
    fs.closeSync(fileDescriptor);
  }
};
// Run an external command with the given path, name, and arguments
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

    child.on('error', resolve);
    child.on('close', () => {
      closeFileDescriptor(stdout);
      closeFileDescriptor(stderr);
      resolve();
    });
  });
};
// Split command tokens into pipeline commands.
const splitPipeline = (args) => {
  const pipeIndex = args.indexOf('|');

  if (pipeIndex === -1) {
    return null;
  }

  const commands = [];
  let currentCommand = [];

  for (const arg of args) {
    if (arg === '|') {
      commands.push(currentCommand);
      currentCommand = [];
      continue;
    }

    currentCommand.push(arg);
  }

  commands.push(currentCommand);
  return commands;
};

// Get builtin command output for pipeline execution.
const getBuiltinOutput = (commandName, commandArgs) => {
  switch (commandName) {
    case 'echo':
      return `${commandArgs.join(' ')}\n`;
    case 'pwd':
      return `${process.cwd()}\n`;
    case 'type':
      if (commandArgs.length === 0) {
        return 'type: missing operand\n';
      }

      if (BUILT_INS.includes(commandArgs[0])) {
        return `${commandArgs[0]} is a shell builtin\n`;
      }

      const executablePath = findExecutable(commandArgs[0]);
      return executablePath === null
        ? `${commandArgs[0]}: not found\n`
        : `${commandArgs[0]} is ${executablePath}\n`;
    default:
      return '';
  }
};

// Run a pipeline segment and collect its output.
const collectCommandOutput = (command, input) => {
  return new Promise((resolve) => {
    const commandName = command[0];
    const commandArgs = command.slice(1);

    if (BUILT_INS.includes(commandName)) {
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

// Run external commands connected by streaming pipes.
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

// Run commands connected by a pipe.
const runPipeline = (commands) => {
  return new Promise(async (resolve) => {
    const hasBuiltin = commands.some((command) => BUILT_INS.includes(command[0]));

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
// Parse the command line input into an array of arguments
const parseCommandLine = (command) => {
  const args = [];
  let currentArg = '';
  let isInsideSingleQuotes = false;
  let isInsideDoubleQuotes = false;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];

    if (char === '\\' && !isInsideSingleQuotes) {
      if (index + 1 < command.length) {
        currentArg += command[index + 1];
        index++;
      } else {
        currentArg += char;
      }
      continue;
    }

    if (char === "'" && !isInsideDoubleQuotes) {
      isInsideSingleQuotes = !isInsideSingleQuotes;
      continue;
    }

    if (char === '"' && !isInsideSingleQuotes) {
      isInsideDoubleQuotes = !isInsideDoubleQuotes;
      continue;
    }

    if (char === ' ' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }
      continue;
    }

    if (char === '>' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      const isAppendRedirection = command[index + 1] === '>';

      if (currentArg === '1' || currentArg === '2') {
        args.push(`${currentArg}${isAppendRedirection ? '>>' : '>'}`);
        currentArg = '';
        if (isAppendRedirection) {
          index++;
        }
        continue;
      }

      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }

      args.push(isAppendRedirection ? '>>' : '>');
      if (isAppendRedirection) {
        index++;
      }
      continue;
    }

    if (char === '|' && !isInsideSingleQuotes && !isInsideDoubleQuotes) {
      if (currentArg !== '') {
        args.push(currentArg);
        currentArg = '';
      }

      args.push(char);
      continue;
    }

    currentArg += char;
  }

  if (currentArg !== '') {
    args.push(currentArg);
  }

  return args;
};
// Handle a single command
const handleCommand = async (commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
  switch (commandName) {
    case 'echo':
      writeOutput(commandArgs.join(' '), stdoutFile, stdoutMode);
      break;
    case 'cd':
      if (commandArgs.length === 0) {
        console.log('cd: missing operand');
      } else {
        const requestedDirectory = commandArgs[0];
        const targetDirectory = requestedDirectory === '~'
          ? process.env.HOME
          : requestedDirectory;

        try {
          process.chdir(targetDirectory);
        } catch {
          console.log(`cd: ${requestedDirectory}: No such file or directory`);
        }
      }
      break;
    case 'pwd':
      writeOutput(process.cwd(), stdoutFile, stdoutMode);
      break;
    case 'exit':
      process.exit(0);
      break;
    case 'complete':
      if (commandArgs[0] === '-C' && commandArgs[1] !== undefined && commandArgs[2] !== undefined) {
        completionSpecs.set(commandArgs[2], commandArgs[1]);
      } else if (commandArgs[0] === '-r' && commandArgs[1] !== undefined) {
        completionSpecs.delete(commandArgs[1]);
      } else if (commandArgs[0] === '-p' && commandArgs[1] !== undefined) {
        const completerPath = completionSpecs.get(commandArgs[1]);

        if (completerPath !== undefined) {
          writeOutput(
            `complete -C '${completerPath}' ${commandArgs[1]}`,
            stdoutFile,
            stdoutMode,
          );
        } else {
          writeOutput(
            `complete: ${commandArgs[1]}: no completion specification`,
            stderrFile,
            stderrMode,
          );
        }
      }
      break;
    case 'jobs':
      await waitForBackgroundJobEvents();
      printJobs(stdoutFile, stdoutMode);
      break;
    case 'history':
      if (commandArgs[0] === '-r' && commandArgs[1] !== undefined) {
        readHistoryFile(commandArgs[1]);
      } else if (commandArgs[0] === '-w' && commandArgs[1] !== undefined) {
        writeHistoryFile(commandArgs[1]);
      } else {
        printHistory(
          commandArgs[0] === undefined ? null : Number(commandArgs[0]),
          stdoutFile,
          stdoutMode,
        );
      }
      break;
    default:
      writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
  }
};
// Handle a single line of input from the user
const handleLine = async (command) => {
  previousCompletionPrefix = null;
  previousCompletionHadMultipleMatches = false;

  const trimmedCommand = command.trim();

  if (trimmedCommand === '') {
    prompt();
    return;
  }

  commandHistory.push(trimmedCommand);

  const args = parseCommandLine(trimmedCommand);
  const pipeline = splitPipeline(args);

  if (pipeline !== null) {
    await runPipeline(pipeline);
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
    if (commandArgs.length === 0) {
      console.log('type: missing operand');
      prompt();
      return;
    }
    if (BUILT_INS.includes(commandArgs[0])) {
      writeOutput(`${commandArgs[0]} is a shell builtin`, stdoutFile, stdoutMode);
      prompt();
      return;
    }

    const executablePath = findExecutable(commandArgs[0]);

    if (executablePath === null) {
      writeOutput(`${commandArgs[0]}: not found`, stderrFile, stderrMode);
    } else {
      writeOutput(`${commandArgs[0]} is ${executablePath}`, stdoutFile, stdoutMode);
    }

    prompt();
    return;
  }

  if (BUILT_INS.includes(commandName)) {
    await handleCommand(commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
    prompt();
    return;
  }

  const executablePath = findExecutable(commandName);

  if (executablePath === null) {
    writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
    prompt();
    return;
  }

  const child = await runExternalCommand(
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
      id: getNextJobId(),
      pid: child.pid,
      command: [commandName, ...commandArgs].join(' '),
      status: 'Running',
    };

    child.on('close', () => {
      job.status = 'Done';
    });

    backgroundJobs.push(job);
    console.log(`[${job.id}] ${job.pid}`);
  }

  prompt();
};
// Handle each line of input sequentially.
let pendingCommand = Promise.resolve();
// Flag to indicate whether the readline interface is closed.
let isReadlineClosed = false;
// Set the isReadlineClosed flag when the readline interface is closed.
rl.on('close', () => {
  isReadlineClosed = true;
});
prompt();
// Handle each line of input sequentially.
rl.on('line', (command) => {
  pendingCommand = pendingCommand.then(() => handleLine(command));
});
