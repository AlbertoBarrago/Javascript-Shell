const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const BUILT_INS = ['type', 'echo', 'cd', 'exit', 'pwd', 'complete', 'jobs'];
const REDIRECTION_OPERATORS = ['>', '1>', '2>', '>>', '1>>', '2>>'];
const completionSpecs = new Map();
const backgroundJobs = [];
let nextJobId = 1;

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

    currentArg += char;
  }

  if (currentArg !== '') {
    args.push(currentArg);
  }

  return args;
};
// Handle a single command
const handleCommand = (commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
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

  const args = parseCommandLine(trimmedCommand);
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
    handleCommand(commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode);
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
      id: nextJobId,
      pid: child.pid,
      command: [commandName, ...commandArgs].join(' '),
      status: 'Running',
    };

    backgroundJobs.push(job);
    console.log(`[${job.id}] ${job.pid}`);
    nextJobId++;
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
