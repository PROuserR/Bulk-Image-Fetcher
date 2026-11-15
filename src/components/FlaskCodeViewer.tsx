import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Copy,
  Check,
  Download,
  Folder,
  FileText,
  FileCheck,
  Layers,
  Terminal,
} from 'lucide-react';
import { fetchApiJson } from '../utils/safeFetchJson';

interface FlaskFile {
  name: string;
  language: string;
  content: string;
}

interface FlaskCodeViewerProps {
  onExportZip: () => void;
  isExportingZip: boolean;
}

export const FlaskCodeViewer: React.FC<FlaskCodeViewerProps> = ({
  onExportZip,
  isExportingZip,
}) => {
  const [files, setFiles] = useState<FlaskFile[]>([]);
  const [activeFileName, setActiveFileName] = useState<string>('app.py');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchApiJson<{ files?: FlaskFile[] }>('/api/flask-files')
      .then(({ ok, data, error }) => {
        if (ok && data?.files && Array.isArray(data.files)) {
          setFiles(data.files);
        } else if (error) {
          console.error('Failed to load Flask files:', error);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load Flask files:', err);
        setIsLoading(false);
      });
  }, []);

  const activeFile = files.find((f) => f.name === activeFileName) || files[0];

  const handleCopy = () => {
    if (activeFile) {
      navigator.clipboard.writeText(activeFile.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden transition-colors">
      {/* Code Header Bar */}
      <div className="p-5 sm:p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950">
              Py
            </span>
            <h2 className="text-lg font-display font-bold text-zinc-950 dark:text-zinc-50 tracking-tight">
              Python Flask Project Architecture
            </h2>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5">
            Clean, modular structure with OOP <code className="font-mono text-zinc-900 dark:text-zinc-200 font-semibold">ImageScraper</code>,
            streaming ZIP generation, and modern HTML5/CSS3/ES6 static assets.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'Copied File' : 'Copy File'}</span>
          </button>

          <a
            href="/api/export-flask-project"
            download="flask_image_scraper_project.zip"
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Flask App (.ZIP)</span>
          </a>

          <a
            href="/api/export-full-project"
            download="fullres_scraper_full_codebase.zip"
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Full Project (.ZIP)</span>
          </a>
        </div>
      </div>

      {/* Main IDE Workspace */}
      <div className="flex flex-col md:flex-row min-h-[500px]">
        {/* Sidebar File Tree */}
        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0D0F16] p-3 space-y-1">
          <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider px-2 py-1.5 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-blue-600 dark:text-blue-500" />
            <span>flask_app/</span>
          </div>

          {isLoading ? (
            <div className="p-4 text-xs text-zinc-400">Loading files...</div>
          ) : (
            files.map((file) => {
              const isActive = file.name === activeFileName;
              return (
                <button
                  key={file.name}
                  onClick={() => setActiveFileName(file.name)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors text-left truncate cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-zinc-100'
                  }`}
                >
                  <FileCode className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-zinc-400'}`} />
                  <span className="truncate">{file.name}</span>
                </button>
              );
            })
          )}
        </div>

        {/* Code Content View */}
        <div className="flex-1 bg-[#0B0C10] text-zinc-100 flex flex-col overflow-hidden">
          {/* File bar */}
          <div className="px-4 py-2.5 bg-[#111318] border-b border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
            <span className="text-zinc-200">{activeFile?.name || 'app.py'}</span>
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">
              {activeFile?.language || 'python'}
            </span>
          </div>

          <div className="flex-1 p-4 overflow-auto max-h-[600px] font-mono text-xs leading-relaxed selection:bg-blue-800">
            <pre>
              <code>{activeFile?.content || '// Loading content...'}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
