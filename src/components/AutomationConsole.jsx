import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useProject } from '../store/ProjectContext';
import { parseVBS, createExecutor, EXAMPLE_VBS } from '../engine/automationEngine';

/**
 * AutomationConsole — A collapsible bottom drawer with a VBS command editor
 * and a live execution log output area.
 */
export default function AutomationConsole({ isOpen, onToggle, isRunning, setIsRunning, currentStep, setCurrentStep, abortRef }) {
  const { state, actions } = useProject();
  const [script, setScript] = useState('');
  const [logs, setLogs] = useState([]);
  const [errors, setErrors] = useState([]);
  const executorRef = useRef(null);
  const logEndRef = useRef(null);
  const textareaRef = useRef(null);
  const [consoleHeight, setConsoleHeight] = useState(240);
  const resizingRef = useRef(false);

  // Keep a ref of the latest state to avoid stale closures in the async VBS executor
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Syntax validation utility for VBS console
  const validateScript = useCallback((text) => {
    if (!text.trim()) {
      setErrors([]);
      return;
    }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const errs = [];
    const validCommands = new Set([
      'LOAD_PRESET', 'LOAD_MODEL', 'SET_VOICE', 'PARSE_SCRIPT', 
      'APPLY_RANDOM_BACKGROUND', 'GENERATE_VOICES', 'APPLY_VOICES', 
      'RENDER', 'UNLOAD_MODEL', 'SET', 'FOR', 'ENDFOR', 'IF', 'ELSE', 'ENDIF',
      'WAIT', 'SET_STYLE', 'SET_ANIMATION'
    ]);

    const controlStack = [];
    let inMultiLine = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNum = idx + 1;
      const rawLine = lines[idx].trim();

      if (!rawLine || rawLine.startsWith('#')) continue;

      if (rawLine.includes('"""')) {
        const firstIdx = rawLine.indexOf('"""');
        const secondIdx = rawLine.indexOf('"""', firstIdx + 3);
        if (secondIdx === -1) {
          inMultiLine = !inMultiLine;
        }
        continue;
      }

      if (inMultiLine) continue;

      const spaceIdx = rawLine.indexOf(' ');
      const command = (spaceIdx === -1 ? rawLine : rawLine.substring(0, spaceIdx)).toUpperCase();

      if (!validCommands.has(command)) {
        errs.push({ line: lineNum, message: `Unknown command "${command}"` });
        continue;
      }

      if (command === 'FOR' || command === 'IF') {
        controlStack.push({ command, line: lineNum });
      } else if (command === 'ELSE') {
        const top = controlStack[controlStack.length - 1];
        if (!top || top.command !== 'IF') {
          errs.push({ line: lineNum, message: `ELSE without matching IF` });
        }
      } else if (command === 'ENDFOR') {
        const top = controlStack.pop();
        if (!top || top.command !== 'FOR') {
          errs.push({ line: lineNum, message: `ENDFOR without matching FOR` });
        }
      } else if (command === 'ENDIF') {
        const top = controlStack.pop();
        if (top && top.command === 'ELSE') {
          controlStack.pop(); // pop matching IF
        } else if (top && top.command === 'IF') {
          // matched
        } else {
          errs.push({ line: lineNum, message: `ENDIF without matching IF` });
        }
      }
    }

    while (controlStack.length > 0) {
      const unclosed = controlStack.pop();
      errs.push({ line: unclosed.line, message: `Unclosed control structure: ${unclosed.command}` });
    }

    setErrors(errs);
  }, []);

  useEffect(() => {
    validateScript(script);
  }, [script, validateScript]);

  const insertSnippet = useCallback((snippetText) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setScript(prev => prev + '\n' + snippetText);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newVal = script.substring(0, start) + '\n' + snippetText + '\n' + script.substring(end);
    setScript(newVal);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + snippetText.length + 2;
    });
  }, [script]);

  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setLogs(prev => [...prev, { id, message, type, timestamp }]);

    // Update current step display for status bar
    if (type === 'system' && message.startsWith('[')) {
      setCurrentStep(message);
    }
  }, [setCurrentStep]);

  const getStateSnapshot = useCallback(() => stateRef.current, []);

  const handleRun = useCallback(async () => {
    if (!script.trim()) {
      addLog('⚠️ No script to execute. Write or paste a VBS command.', 'warning');
      return;
    }

    // Parse the VBS script
    let commands;
    try {
      commands = parseVBS(script);
    } catch (err) {
      addLog(`❌ Parse error: ${err.message}`, 'error');
      return;
    }

    if (commands.length === 0) {
      addLog('⚠️ No commands found in script (only comments/empty lines).', 'warning');
      return;
    }

    setIsRunning(true);
    setLogs([]);

    const executor = createExecutor(actions, getStateSnapshot, addLog);
    executorRef.current = executor;
    if (abortRef) {
      abortRef.current = () => executor.abort();
    }

    try {
      const result = await executor.execute(commands);
      if (result.success) {
        actions.addToast('VBS script executed successfully!', 'success');
      } else if (result.aborted) {
        actions.addToast('VBS script execution aborted.', 'warning');
      } else {
        actions.addToast(`VBS script failed: ${result.error}`, 'error');
      }
    } catch (err) {
      addLog(`❌ Unexpected error: ${err.message}`, 'error');
      actions.addToast(`VBS execution error: ${err.message}`, 'error');
    } finally {
      setIsRunning(false);
      setCurrentStep('');
      executorRef.current = null;
      if (abortRef) {
        abortRef.current = null;
      }
    }
  }, [script, actions, getStateSnapshot, addLog, setIsRunning, setCurrentStep, abortRef]);

  const handleStop = useCallback(() => {
    if (executorRef.current) {
      executorRef.current.abort();
    }
  }, []);

  const handleClear = useCallback(() => {
    setLogs([]);
    setCurrentStep('');
  }, [setCurrentStep]);

  const handleLoadExample = useCallback(() => {
    setScript(EXAMPLE_VBS);
    addLog('📋 Example VBS script loaded. Click ▶ Run to execute.', 'info');
  }, [addLog]);

  // Console resize handler
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    resizingRef.current = true;
    const startY = e.clientY;
    const startHeight = consoleHeight;

    const handleMouseMove = (e) => {
      if (!resizingRef.current) return;
      const dy = startY - e.clientY;
      setConsoleHeight(Math.max(160, Math.min(600, startHeight + dy)));
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [consoleHeight]);

  useEffect(() => {
    return () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isOpen]);

  // Tab key handling in textarea
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const newVal = script.substring(0, start) + '  ' + script.substring(end);
      setScript(newVal);
      requestAnimationFrame(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 2;
      });
    }
  }, [script]);

  const getLogColor = (type) => {
    switch (type) {
      case 'success': return 'var(--vbs-success, #4caf50)';
      case 'error': return 'var(--vbs-error, #ff5252)';
      case 'warning': return 'var(--vbs-warning, #ffc107)';
      case 'system': return 'var(--vbs-system, #00e5ff)';
      default: return 'var(--vbs-info, #b0bec5)';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="automation-console" style={{ height: consoleHeight }}>
      {/* Resize handle */}
      <div
        className="automation-console__resize-handle"
        onMouseDown={handleResizeStart}
      />

      {/* Header bar */}
      <div className="automation-console__header">
        <div className="automation-console__header-left">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="automation-console__title">VBS Console</span>
          <span className="automation-console__badge">VIBE Build Script</span>
        </div>
        <div className="automation-console__header-right">
          {currentStep && (
            <span className="automation-console__status">{currentStep}</span>
          )}
          <button
            className="automation-console__btn automation-console__btn--example"
            onClick={handleLoadExample}
            disabled={isRunning}
            title="Load example VBS script"
          >
            📋 Example
          </button>
          <button
            className={`automation-console__btn ${isRunning ? 'automation-console__btn--disabled' : 'automation-console__btn--run'}`}
            onClick={handleRun}
            disabled={isRunning}
            title="Execute VBS script"
          >
            ▶ Run
          </button>
          <button
            className={`automation-console__btn ${!isRunning ? 'automation-console__btn--disabled' : 'automation-console__btn--stop'}`}
            onClick={handleStop}
            disabled={!isRunning}
            title="Stop execution"
          >
            ⏹ Stop
          </button>
          <button
            className="automation-console__btn automation-console__btn--clear"
            onClick={handleClear}
            title="Clear log output"
          >
            🗑 Clear
          </button>
          <button
            className="automation-console__btn automation-console__btn--close"
            onClick={onToggle}
            title="Close console"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main content: editor + log split */}
      <div className="automation-console__body">
        {/* Left: Script Editor */}
        <div className="automation-console__editor" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="automation-console__editor-label">
            <span>Script</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="automation-console__snippet-btn"
                onClick={() => insertSnippet('FOR i = 1 TO 3\n  APPLY_RANDOM_BACKGROUND\nENDFOR')}
                style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--surface-2)', border: 'none', borderRadius: 3, color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="Insert a FOR loop snippet"
              >
                + Loop
              </button>
              <button
                className="automation-console__snippet-btn"
                onClick={() => insertSnippet('IF FILE_EXISTS("presets/media/videos/bg.mp4")\n  # do something\nENDIF')}
                style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--surface-2)', border: 'none', borderRadius: 3, color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="Insert an IF conditional check snippet"
              >
                + Condition
              </button>
              <button
                className="automation-console__snippet-btn"
                onClick={() => insertSnippet('SET speed = 1.25\nLOAD_MODEL luxtts\nSET_VOICE char_stewie speed=$speed')}
                style={{ fontSize: '9px', padding: '2px 6px', background: 'var(--surface-2)', border: 'none', borderRadius: 3, color: 'var(--text-secondary)', cursor: 'pointer' }}
                title="Insert a SET variables snippet"
              >
                + Variable
              </button>
            </div>
            <span className="automation-console__line-count">
              {script.split('\n').length} lines
            </span>
          </div>
          <textarea
            ref={textareaRef}
            className="automation-console__textarea"
            style={{ flex: 1 }}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`# Paste your VBS command here...\n# Example:\nPARSE_SCRIPT """\n**Character:** Dialogue text here.\n"""\n\nLOAD_MODEL qwen3tts_0.6b\nSET_VOICE character type=default\nGENERATE_VOICES\nAPPLY_VOICES\nRENDER output="video.mp4"\nUNLOAD_MODEL`}
            spellCheck={false}
            disabled={isRunning}
          />
          {errors.length > 0 && (
            <div className="automation-console__errors-panel" style={{
              background: 'rgba(255,82,82,0.1)',
              borderTop: '1px solid var(--accent-danger, #ff4081)',
              padding: '6px 12px',
              fontSize: 'var(--text-xs)',
              maxHeight: 80,
              overflowY: 'auto'
            }}>
              {errors.map((err, idx) => (
                <div key={idx} style={{ color: 'var(--accent-danger, #ff5252)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold' }}>Line {err.line}:</span>
                  <span>{err.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="automation-console__divider" />

        {/* Right: Log Output */}
        <div className="automation-console__log">
          <div className="automation-console__editor-label">
            <span>Output</span>
            {isRunning && (
              <span className="automation-console__running-indicator">
                <span className="automation-console__pulse" />
                Running
              </span>
            )}
          </div>
          <div className="automation-console__log-area">
            {logs.length === 0 ? (
              <div className="automation-console__empty">
                <span style={{ fontSize: '24px', marginBottom: 8 }}>⌘</span>
                <span>Output will appear here when you run a VBS script.</span>
                <span style={{ fontSize: '11px', opacity: 0.5, marginTop: 4 }}>
                  Click "📋 Example" to load a sample script.
                </span>
              </div>
            ) : (
              logs.map((entry, idx) => (
                <div
                  key={entry.id || idx}
                  className="automation-console__log-entry"
                  style={{ color: getLogColor(entry.type) }}
                >
                  <span className="automation-console__log-time">{entry.timestamp}</span>
                  <span className="automation-console__log-msg">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
