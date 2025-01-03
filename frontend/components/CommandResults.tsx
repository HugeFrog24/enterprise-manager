import React from 'react';
import type { CommandResult } from '@/lib/types/api';
import Image from 'next/image';

type Props = {
  results: CommandResult | CommandResult[];
};

export const CommandResults: React.FC<Props> = ({ results }) => {
  const resultArray = Array.isArray(results) ? results : [results];
  
  const isBase64Image = (str: string) => {
    try {
      // Check if the string starts with "Screenshot saved: " and contains base64 data
      if (!str.startsWith('Screenshot saved: ')) return false;
      
      // Extract the base64 part
      const base64Data = str.split('Screenshot saved: ')[1];
      if (!base64Data) return false;

      // Check if it's a valid base64 string
      const decoded = atob(base64Data);
      // Check if it starts with PNG header bytes
      const header = new Uint8Array(decoded.split('').map(char => char.charCodeAt(0))).slice(0, 8);
      return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    } catch {
      return false;
    }
  };

  const extractBase64Data = (str: string) => {
    return str.split('Screenshot saved: ')[1];
  };

  return (
    <div className="mt-4">
      <div className="space-y-3">
        {resultArray.length === 0 ? (
          <p className="text-gray-500 text-sm">No commands executed yet</p>
        ) : (
          resultArray.map((result, index) => (
            <div
              key={result.taskId || `result-${index}`}
              className="p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      result.status === 'completed' && result.exitCode === 0
                        ? 'bg-green-100 text-green-800'
                        : result.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {result.status} {result.exitCode !== null && `(Exit: ${result.exitCode})`}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  <div>{new Date(result.startTime).toLocaleString()}</div>
                  {result.endTime && (
                    <div>{new Date(result.endTime).toLocaleString()}</div>
                  )}
                </div>
              </div>
              {result.output && isBase64Image(result.output) ? (
                <div className="mt-2">
                  <Image
                    src={`data:image/png;base64,${extractBase64Data(result.output)}`}
                    alt="Screenshot"
                    width={800}
                    height={600}
                    className="w-full h-auto"
                  />
                </div>
              ) : result.output && (
                <pre className="mt-2 p-2 bg-black text-white rounded text-sm overflow-x-auto">
                  {result.output}
                </pre>
              )}
              {result.error && (
                <pre className="mt-2 p-2 bg-red-50 text-red-900 rounded text-sm overflow-x-auto">
                  {result.error}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
