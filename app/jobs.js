const createJobs = (writeOutput) => {
  const backgroundJobs = [];

  const getNextJobId = () => {
    if (backgroundJobs.length === 0) {
      return 1;
    }

    return Math.max(...backgroundJobs.map((job) => job.id)) + 1;
  };

  const printJobs = (stdoutFile, stdoutMode) => {
    const mostRecentJobIndex = backgroundJobs.length - 1;
    const previousJobIndex = backgroundJobs.length - 2;
    const lines = [];

    for (const [index, job] of backgroundJobs.entries()) {
      const marker = index === mostRecentJobIndex
        ? '+'
        : index === previousJobIndex
          ? '-'
          : ' ';
      const command = job.status === 'Running' ? `${job.command} &` : job.command;
      lines.push(`[${job.id}]${marker}  ${job.status.padEnd(24, ' ')}${command}`);
    }

    if (lines.length > 0) {
      writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
    }

    for (let index = backgroundJobs.length - 1; index >= 0; index--) {
      if (backgroundJobs[index].status === 'Done') {
        backgroundJobs.splice(index, 1);
      }
    }
  };

  const reapDoneJobs = (stdoutFile, stdoutMode) => {
    const mostRecentJobIndex = backgroundJobs.length - 1;
    const previousJobIndex = backgroundJobs.length - 2;
    const lines = [];

    for (const [index, job] of backgroundJobs.entries()) {
      if (job.status !== 'Done') {
        continue;
      }

      const marker = index === mostRecentJobIndex
        ? '+'
        : index === previousJobIndex
          ? '-'
          : ' ';
      lines.push(`[${job.id}]${marker}  ${job.status.padEnd(24, ' ')}${job.command}`);
    }

    if (lines.length > 0) {
      writeOutput(lines.join('\n'), stdoutFile, stdoutMode);
    }

    for (let index = backgroundJobs.length - 1; index >= 0; index--) {
      if (backgroundJobs[index].status === 'Done') {
        backgroundJobs.splice(index, 1);
      }
    }
  };

  const waitForBackgroundJobEvents = () => {
    return new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  };

  return {
    backgroundJobs,
    getNextJobId,
    printJobs,
    reapDoneJobs,
    waitForBackgroundJobEvents,
  };
};

module.exports = {
  createJobs,
};
