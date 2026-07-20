import fs from 'node:fs';

/**
 * Write a message to stdout, or fan it out to one or more redirection targets
 * (tee-style multiwrite).
 *
 * @param {string} message - The message (a trailing newline is added).
 * @param {import('./parser.js').RedirectionTarget[]} [targets=[]] - Target
 *   files; when empty the message goes to stdout.
 * @returns {void}
 */
const writeOutput = (message, targets = []) => {
  if (targets.length === 0) {
    console.log(message);
    return;
  }

  for (const { file, mode } of targets) {
    fs.writeFileSync(file, `${message}\n`, {
      flag: mode === 'append' ? 'a' : 'w',
    });
  }
};

/**
 * Create (or truncate) each redirection target file so it exists even if the
 * command produces no output.
 *
 * @param {import('./parser.js').RedirectionTarget[]} [targets=[]] - Targets.
 * @returns {void}
 */
const createRedirectionFile = (targets = []) => {
  for (const { file, mode } of targets) {
    fs.closeSync(fs.openSync(file, mode === 'append' ? 'a' : 'w'));
  }
};

/**
 * Close a file descriptor if the value is an actual numeric descriptor.
 *
 * @param {number|string} fileDescriptor - Descriptor or stdio keyword.
 * @returns {void}
 */
const closeFileDescriptor = (fileDescriptor) => {
  if (typeof fileDescriptor === 'number') {
    fs.closeSync(fileDescriptor);
  }
};

export { closeFileDescriptor, createRedirectionFile, writeOutput };
