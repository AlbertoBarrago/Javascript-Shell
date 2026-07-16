const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const VALID_COMMANDS = ['exit', 'echo', 'cd'];

rl.prompt();
rl.on('line', (command) => {
  const args = command.trim().split(/\s+/);
  if (!VALID_COMMANDS.includes(args[0])) {
    console.log(`${args[0]}: command not found`);
    rl.prompt();
    return;
  }
  if (VALID_COMMANDS.includes(arg[0])) {
    console.log(`${args[0]}: is a shell built-in`)
    rl.prompt();
    return;
  }
  rl.prompt();
})
