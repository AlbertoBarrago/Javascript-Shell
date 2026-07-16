import fs from 'node:fs';

const writeOutput = (message, outputFile, outputMode = 'write') => {
  if (outputFile === null) {
    console.log(message);
    return;
  }

  fs.writeFileSync(outputFile, `${message}\n`, {
    flag: outputMode === 'append' ? 'a' : 'w',
  });
};

const createRedirectionFile = (filePath, outputMode) => {
  if (filePath !== null) {
    fs.closeSync(fs.openSync(filePath, outputMode === 'append' ? 'a' : 'w'));
  }
};

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
