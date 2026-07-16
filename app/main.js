const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BUILT_INS = ['type', 'echo', 'cd', 'exit', 'pwd'];
const REDIRECTION_OPERATORS = ['>', '1>', '2>', '>>', '1>>', '2>>'];

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

const completeCommand = (line) => {
  if (line.includes(' ')) {
    return [[], line];
  }

  const candidates = [...BUILT_INS, ...getPathCommands()];
  const matches = candidates
    .filter((candidate) => candidate.startsWith(line))
    .sort();

  return [matches.length === 0 ? candidates : matches, line];
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: completeCommand,
});

let isReadlineClosed = false;

// Prompt the user for input.
const prompt = () => {
  if (!isReadlineClosed) {
    rl.prompt();
  }
};

rl.on('close', () => {
  isReadlineClosed = true;
});

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
const runExternalCommand = (commandPath, commandName, commandArgs, stdoutFile, stdoutMode, stderrFile, stderrMode) => {
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

    child.on('error', resolve);
    child.on('close', () => {
      if (typeof stdout === 'number') {
        fs.closeSync(stdout);
      }

      if (typeof stderr === 'number') {
        fs.closeSync(stderr);
      }

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
    default:
      writeOutput(`${commandName}: command not found`, stderrFile, stderrMode);
  }
};
// Handle a single line of input from the user
const handleLine = async (command) => {
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

  await runExternalCommand(
    executablePath,
    commandName,
    commandArgs,
    stdoutFile,
    stdoutMode,
    stderrFile,
    stderrMode,
  );
  prompt();
};
// Handle each line of input sequentially.
let pendingCommand = Promise.resolve();

prompt();
// Handle each line of input sequentially.
rl.on('line', (command) => {
  pendingCommand = pendingCommand.then(() => handleLine(command));
});
