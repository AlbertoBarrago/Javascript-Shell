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

const runExternalCommand = (commandPath, commandName, commandArgs) => {
  return new Promise((resolve) => {
    const child = spawn(commandPath, commandArgs, {
      argv0: commandName,
      stdio: 'inherit',
    });

    child.on('error', resolve);
    child.on('close', resolve);
  });
};

const handleCommand = (commandName, commandArgs) => {
  switch (commandName) {
    case 'echo':
      console.log(commandArgs.join(' '));
      break;
    case 'cd':
      if (commandArgs.length === 0) {
        console.log('cd: missing operand');
      } else {
        try {
          process.chdir(commandArgs[0]);
        } catch {
          console.log(`cd: ${commandArgs[0]}: No such file or directory`);
        }
      }
      break;
    case 'pwd':
      console.log(process.cwd());
      break;
    case 'exit':
      process.exit(0);
      break;
    default:
      console.log(`${commandName}: command not found`);
  }
};

const handleLine = async (command) => {
  const trimmedCommand = command.trim();

  if (trimmedCommand === '') {
    prompt();
    return;
  }

  const args = trimmedCommand.split(/\s+/);
  const commandName = args[0];
  const commandArgs = args.slice(1);

  if (commandName === 'type') {
    if (commandArgs.length === 0) {
      console.log('type: missing operand');
      prompt();
      return;
    }
    if (BUILT_INS.includes(commandArgs[0])) {
      console.log(`${commandArgs[0]} is a shell builtin`);
      prompt();
      return;
    }

    const executablePath = findExecutable(commandArgs[0]);

    if (executablePath === null) {
      console.log(`${commandArgs[0]}: not found`);
    } else {
      console.log(`${commandArgs[0]} is ${executablePath}`);
    }

    prompt();
    return;
  }

  if (BUILT_INS.includes(commandName)) {
    handleCommand(commandName, commandArgs);
    prompt();
    return;
  }

  const executablePath = findExecutable(commandName);

  if (executablePath === null) {
    console.log(`${commandName}: command not found`);
    prompt();
    return;
  }

  await runExternalCommand(executablePath, commandName, commandArgs);
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
