const fs = require("fs");

const DEFAULT_BUFFER_SIZE = 8192; // 8KB

/**
 * Read the last `n` lines from a file efficiently.
 * Reads backwards from the end of the file using a fixed-size buffer.
 *
 * @param {string} filePath - Path to the file
 * @param {number} n - Number of lines to return (default 5)
 * @param {number} bufferSize - Size of read buffer in bytes (default 8192)
 * @returns {Promise<string[]>} Array of the last n lines
 */
async function tailLines(filePath, n = 5, bufferSize = DEFAULT_BUFFER_SIZE) {
  let fileHandle;
  try {
    fileHandle = await fs.promises.open(filePath, "r");
    const stat = await fileHandle.stat();
    const fileSize = stat.size;

    if (fileSize === 0) return [];

    let position = fileSize;
    let accumulated = "";
    const lines = [];

    while (position > 0 && lines.length < n) {
      const readSize = Math.min(bufferSize, position);
      position -= readSize;

      const buffer = Buffer.alloc(readSize);
      await fileHandle.read(buffer, 0, readSize, position);

      accumulated = buffer.toString("utf-8") + accumulated;

      // Split into lines and check if we have enough
      const parts = accumulated.split("\n");

      if (position > 0) {
        // We might have a partial line at the beginning, keep it for next iteration
        accumulated = parts[0];
        // Add complete lines (from the end) to our result
        for (let i = parts.length - 1; i >= 1; i--) {
          const line = parts[i];
          if (line.length > 0) {
            lines.unshift(line);
            if (lines.length >= n) break;
          }
        }
      } else {
        // We've reached the start of the file, all parts are complete lines
        for (let i = parts.length - 1; i >= 0; i--) {
          const line = parts[i];
          if (line.length > 0) {
            lines.unshift(line);
            if (lines.length >= n) break;
          }
        }
      }
    }

    // Return only the last n lines
    return lines.slice(-n);
  } catch {
    return [];
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

module.exports = { tailLines };
