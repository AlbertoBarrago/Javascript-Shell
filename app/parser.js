import { REDIRECTION_OPERATORS } from './constants.js';

/**
 * Tokenize a command line into arguments, honoring single/double quotes,
 * backslash escaping, whitespace splitting, redirection operators (`>`, `>>`
 * with optional `1`/`2` fd prefixes) and the pipe symbol.
 *
 * @param {string} command - The raw command line.
 * @returns {string[]} The parsed tokens (arguments and operators).
 */
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

/**
 * Split redirection operators and their target files out of a token list.
 *
 * @param {string[]} commandArgs - Tokens following the command name.
 * @returns {{
 *   args: string[],
 *   stdoutFile: string|null,
 *   stdoutMode: 'write'|'append',
 *   stderrFile: string|null,
 *   stderrMode: 'write'|'append'
 * }} The remaining arguments and the resolved redirection targets.
 */
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

/**
 * Split a token list on the pipe operator into per-command token arrays.
 *
 * @param {string[]} args - The full token list.
 * @returns {string[][]|null} One token array per pipeline stage, or `null`
 *   when the line contains no pipe.
 */
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

export {
  extractRedirection,
  parseCommandLine,
  splitPipeline,
};
