import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Create the tab-completion engine: command, file and registered-completer
 * candidates, plus the readline `completer` entry point.
 *
 * @param {string[]} builtIns - Names of the shell builtins.
 * @returns {{
 *   completeCommand: (line: string) => [string[], string],
 *   completionSpecs: Map<string, string>,
 *   resetCompletionState: () => void
 * }} The completion API.
 */
const createCompletion = (builtIns) => {
  const completionSpecs = new Map();
  let previousCompletionPrefix = null;
  let previousCompletionHadMultipleMatches = false;

  /**
   * Reset the double-Tab tracking state.
   *
   * @returns {void}
   */
  const resetCompletionState = () => {
    previousCompletionPrefix = null;
    previousCompletionHadMultipleMatches = false;
  };

  /**
   * Collect the names of all executables reachable through `PATH`.
   *
   * @returns {string[]} Unique executable names.
   */
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

  /**
   * Find the longest common string prefix across the given values.
   *
   * @param {string[]} values - Candidate strings.
   * @returns {string} The longest shared prefix (empty if none).
   */
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

  /**
   * Apply readline completion for a prefix against a candidate list, handling
   * single/no/multiple matches, common-prefix extension and the double-Tab
   * listing behavior.
   *
   * @param {string} line - The full input line.
   * @param {number} replacementStart - Index where the token being completed
   *   starts.
   * @param {string} prefix - The token being completed.
   * @param {string[]} candidates - Possible completions.
   * @returns {[string[], string]} The readline completer result tuple.
   */
  const completeFromCandidates = (line, replacementStart, prefix, candidates) => {
    const matches = candidates
      .filter((candidate) => candidate.startsWith(prefix))
      .sort();
    const lineBeforeReplacement = line.slice(0, replacementStart);

    if (matches.length === 1) {
      resetCompletionState();
      const completedToken = matches[0].endsWith('/')
        ? matches[0]
        : `${matches[0]} `;
      return [[`${lineBeforeReplacement}${completedToken}`], line];
    }

    if (matches.length === 0) {
      resetCompletionState();
      process.stdout.write('\x07');
      return [[], line];
    }

    const commonPrefix = findLongestCommonPrefix(matches);

    if (commonPrefix.length > prefix.length) {
      resetCompletionState();
      return [[`${lineBeforeReplacement}${commonPrefix}`], line];
    }

    if (
      previousCompletionPrefix === line
      && previousCompletionHadMultipleMatches
    ) {
      process.stdout.write(`\n${matches.join('  ')}\n$ ${line}`);
      resetCompletionState();
      return [[], line];
    }

    previousCompletionPrefix = line;
    previousCompletionHadMultipleMatches = true;
    process.stdout.write('\x07');
    return [[], line];
  };

  /**
   * List filesystem completion candidates for a path prefix, appending `/` to
   * directories.
   *
   * @param {string} prefix - The path prefix being completed.
   * @returns {string[]} Matching file and directory names.
   */
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

  /**
   * Query a completer registered via `complete -C`, following the Bash
   * convention (argv + COMP_LINE/COMP_POINT environment).
   *
   * @param {string} commandName - The command being completed.
   * @param {string} currentWord - The word under the cursor.
   * @param {string} previousWord - The word before the cursor.
   * @param {string} line - The full input line.
   * @returns {string[]|null} Candidate lines, or `null` when no completer is
   *   registered for the command.
   */
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

  /**
   * readline `completer`: complete the command word from builtins and `PATH`,
   * or an argument from a registered completer or the filesystem.
   *
   * @param {string} line - The current input line.
   * @returns {[string[], string]} The readline completer result tuple.
   */
  const completeCommand = (line) => {
    const lastSpaceIndex = line.lastIndexOf(' ');

    if (lastSpaceIndex === -1) {
      const candidates = [...new Set([...builtIns, ...getPathCommands()])];
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

  return {
    completeCommand,
    completionSpecs,
    resetCompletionState,
  };
};

export {
  createCompletion,
};
