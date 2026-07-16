const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const VALID_COMMANDS = ['type', 'echo', 'cd', 'exit'];

rl.prompt();
rl.on('line', (command) => {
  const args = command.trim().split(/\s+/);
  const commandName = args[0];
  const commandArgs = args.slice(1);
  if (commandName === 'type') {
    if (commandArgs.length === 0) {
      console.log('type: missing operand');
      rl.prompt();
      return;
    }
    if (!VALID_COMMANDS.includes(commandArgs[0])) {
      console.log(`${commandArgs[0]}: not found`);
    } else {
      console.log(`${commandArgs[0]} is a shell builtin`)
    }
    rl.prompt();
    return;
  }
  if (!VALID_COMMANDS.includes(commandName)) {
    console.log(`${commandName}: command not found`);
    rl.prompt();
    return;
  }
  if (commandName === 'echo') {
    console.log(commandArgs.join(' '));
  }
  if (commandName === 'cd') {
    if (commandArgs.length === 0) {
      console.log('cd: missing operand');
    } else {
      process.chdir(commandArgs[0]);
    }
  }
  if (commandName === 'exit') {
    process.exit(0);
  }
  rl.prompt();
})
