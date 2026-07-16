import fs from 'node:fs';

/**
 * Write a message to stdout or to a redirection target file.
 *
 * @param {string} message - The message (a trailing newline is added).
 * @param {string|null} outputFile - Target file, or `null` for stdout.
 * @param {'write'|'append'} [outputMode='write'] - File write mode.
 * @returns {void}
 */
const writeOutput = (message, outputFile, outputMode = 'write') => {
  if (outputFile === null) {
    console.log(message);
    return;
  }

  fs.writeFileSync(outputFile, `${message}\n`, {
    flag: outputMode === 'append' ? 'a' : 'w',
  });
};

/**
 * Create (or truncate) a redirection target file so it exists even if the
 * command produces no output.
 *
 * @param {string|null} filePath - Target file, or `null` to do nothing.
 * @param {'write'|'append'} outputMode - File open mode.
 * @returns {void}
 */
const createRedirectionFile = (filePath, outputMode) => {
  if (filePath !== null) {
    fs.closeSync(fs.openSync(filePath, outputMode === 'append' ? 'a' : 'w'));
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

export {
  closeFileDescriptor,
  createRedirectionFile,
  writeOutput,
};
