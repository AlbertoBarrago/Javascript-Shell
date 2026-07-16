const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
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

const BUILT_INS = ['type', 'echo', 'cd', 'exit', 'pwd'];

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

const REDIRECTION_OPERATORS = ['>', '1>', '2>'];

const writeOutput = (message, outputFile) => {
  if (outputFile === null) {
    console.log(message);
    return;
  }

  fs.writeFileSync(outputFile, `${message}\n`);
};

const createEmptyFile = (filePath) => {
  if (filePath !== null) {
    fs.closeSync(fs.openSync(filePath, 'w'));
  }
};

const extractRedirection = (commandArgs) => {
  const redirections = {
    stdoutFile: null,
    stderrFile: null,
  };
  const args = [];

  for (let index = 0; index < commandArgs.length; index++) {
    const arg = commandArgs[index];

    if (REDIRECTION_OPERATORS.includes(arg)) {
      const targetFile = commandArgs[index + 1] || null;

      if (arg === '2>') {
        redirections.stderrFile = targetFile;
      } else {
        redirections.stdoutFile = targetFile;
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

const runExternalCommand = (commandPath, commandName, commandArgs, stdoutFile, stderrFile) => {
  return new Promise((resolve) => {
    const stdout = stdoutFile === null ? 'inherit' : fs.openSync(stdoutFile, 'w');
    const stderr = stderrFile === null ? 'inherit' : fs.openSync(stderrFile, 'w');
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
      if (currentArg === '1' || currentArg === '2') {
        args.push(`${currentArg}>`);
        currentArg = '';
        continue;
      }

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

const handleCommand = (commandName, commandArgs, stdoutFile, stderrFile) => {
  switch (commandName) {
    case 'echo':
      writeOutput(commandArgs.join(' '), stdoutFile);
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
      writeOutput(process.cwd(), stdoutFile);
      break;
    case 'exit':
      process.exit(0);
      break;
    default:
      writeOutput(`${commandName}: command not found`, stderrFile);
  }
};

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
    stderrFile,
  } = extractRedirection(args.slice(1));

  createEmptyFile(stdoutFile);
  createEmptyFile(stderrFile);

  if (commandName === 'type') {
    if (commandArgs.length === 0) {
      console.log('type: missing operand');
      prompt();
      return;
    }
    if (BUILT_INS.includes(commandArgs[0])) {
      writeOutput(`${commandArgs[0]} is a shell builtin`, stdoutFile);
      prompt();
      return;
    }

    const executablePath = findExecutable(commandArgs[0]);

    if (executablePath === null) {
      writeOutput(`${commandArgs[0]}: not found`, stderrFile);
    } else {
      writeOutput(`${commandArgs[0]} is ${executablePath}`, stdoutFile);
    }

    prompt();
    return;
  }

  if (BUILT_INS.includes(commandName)) {
    handleCommand(commandName, commandArgs, stdoutFile, stderrFile);
    prompt();
    return;
  }

  const executablePath = findExecutable(commandName);

  if (executablePath === null) {
    writeOutput(`${commandName}: command not found`, stderrFile);
    prompt();
    return;
  }

  await runExternalCommand(executablePath, commandName, commandArgs, stdoutFile, stderrFile);
  prompt();
};

let pendingCommand = Promise.resolve();

// Read user input and handle commands asynchronously.
prompt();
// Handle each line of input sequentially.
rl.on('line', (command) => {
  // Wait for the current command to complete before handling the next one.
  pendingCommand = pendingCommand.then(() => handleLine(command));
});
