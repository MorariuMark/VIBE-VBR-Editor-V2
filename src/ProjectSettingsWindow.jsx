const ASPECT_RATIO_PRESETS = [
  { name: 'Landscape (16:9) [Default]', width: 1920, height: 1080, ratio: 16/9 },
  { name: 'Vertical Portrait (9:16)', width: 1080, height: 1920, ratio: 9/16 },
  { name: 'Square (1:1)', width: 1080, height: 1080, ratio: 1/1 },
  { name: 'Standard (4:3)', width: 1440, height: 1080, ratio: 4/3 },
  { name: 'Classic Portrait (2:3)', width: 1080, height: 1620, ratio: 2/3 },
];

export default function ProjectSettingsWindow() {
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(60);
  const [brollLayout, setBrollLayout] = useState('none');
  const [aspectRatioLock, setAspectRatioLock] = useState(true);
  const [preset, setPreset] = useState('0'); // landscape 16:9 index

  const [brollX, setBrollX] = useState(50);
  const [brollY, setBrollY] = useState(20);
  const [brollWidth, setBrollWidth] = useState(80);
  const [brollHeight, setBrollHeight] = useState(25);
  const [brollAspectRatio, setBrollAspectRatio] = useState('custom');

  const handleBrollWidthChange = (val) => {
    let newW = parseFloat(val) || 0;
    newW = Math.max(5, Math.min(100, newW));
    setBrollWidth(newW);

    if (brollAspectRatio !== 'custom') {
      let ratio = 16/9;
      if (brollAspectRatio === '9:16') ratio = 9/16;
      else if (brollAspectRatio === '1:1') ratio = 1/1;
      else if (brollAspectRatio === '4:3') ratio = 4/3;

      const wPx = width * (newW / 100);
      const hPx = wPx / ratio;
      const hPct = Math.min(100, Math.max(5, (hPx / height) * 100));
      setBrollHeight(Math.round(hPct * 10) / 10);
    }
  };

  const handleBrollHeightChange = (val) => {
    let newH = parseFloat(val) || 0;
    newH = Math.max(5, Math.min(100, newH));
    setBrollHeight(newH);

    if (brollAspectRatio !== 'custom') {
      let ratio = 16/9;
      if (brollAspectRatio === '9:16') ratio = 9/16;
      else if (brollAspectRatio === '1:1') ratio = 1/1;
      else if (brollAspectRatio === '4:3') ratio = 4/3;

      const hPx = height * (newH / 100);
      const wPx = hPx * ratio;
      const wPct = Math.min(100, Math.max(5, (wPx / width) * 100));
      setBrollWidth(Math.round(wPct * 10) / 10);
    }
  };

  const handleBrollAspectRatioChange = (val) => {
    setBrollAspectRatio(val);
    if (val !== 'custom') {
      let ratio = 16/9;
      if (val === '9:16') ratio = 9/16;
      else if (val === '1:1') ratio = 1/1;
      else if (val === '4:3') ratio = 4/3;

      const wPx = width * (brollWidth / 100);
      const hPx = wPx / ratio;
      const hPct = Math.min(100, Math.max(5, (hPx / height) * 100));
      setBrollHeight(Math.round(hPct * 10) / 10);
    }
  };

  // Theme synchronization from local storage
  useEffect(() => {
    const applyTheme = () => {
      const activeTheme = localStorage.getItem('theme') || 'default';
      document.body.classList.remove('theme-blue', 'theme-red');
      if (activeTheme === 'blue') {
        document.body.classList.add('theme-blue');
      } else if (activeTheme === 'red') {
        document.body.classList.add('theme-red');
      }
    };
    applyTheme();
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      if (window.electronAPI && window.electronAPI.getActiveSettingsState) {
        const initial = await window.electronAPI.getActiveSettingsState();
        if (initial) {
          setWidth(initial.canvasWidth || 1080);
          setHeight(initial.canvasHeight || 1920);
          setFps(initial.fps || 60);
          setBrollLayout(initial.brollLayout || 'none');
          setBrollX(initial.brollX !== undefined ? initial.brollX : 50);
          setBrollY(initial.brollY !== undefined ? initial.brollY : 20);
          setBrollWidth(initial.brollWidth !== undefined ? initial.brollWidth : 80);
          setBrollHeight(initial.brollHeight !== undefined ? initial.brollHeight : 25);
          setBrollAspectRatio(initial.brollAspectRatio || 'custom');
          
          // Match initial resolution to preset index if possible
          const matchIdx = ASPECT_RATIO_PRESETS.findIndex(p => p.width === initial.canvasWidth && p.height === initial.canvasHeight);
          setPreset(matchIdx !== -1 ? matchIdx.toString() : 'custom');
        }
      }
    };
    fetchSettings();
  }, []);

  const handlePresetChange = (e) => {
    const val = e.target.value;
    setPreset(val);
    if (val !== 'custom') {
      const selected = ASPECT_RATIO_PRESETS[parseInt(val)];
      if (selected) {
        setWidth(selected.width);
        setHeight(selected.height);
      }
    }
  };

  const handleWidthChange = (e) => {
    const val = Math.max(100, Math.min(4000, parseInt(e.target.value) || 0));
    setWidth(val);
    
    if (aspectRatioLock && preset !== 'custom') {
      const selected = ASPECT_RATIO_PRESETS[parseInt(preset)];
      if (selected) {
        setHeight(Math.round(val / selected.ratio));
      } else {
        const ratio = width / height || 9/16;
        setHeight(Math.round(val / ratio));
      }
    } else if (aspectRatioLock) {
      const ratio = width / height || 9/16;
      setHeight(Math.round(val / ratio));
    }
  };

  const handleHeightChange = (e) => {
    const val = Math.max(100, Math.min(4000, parseInt(e.target.value) || 0));
    setHeight(val);
    
    if (aspectRatioLock && preset !== 'custom') {
      const selected = ASPECT_RATIO_PRESETS[parseInt(preset)];
      if (selected) {
        setWidth(Math.round(val * selected.ratio));
      } else {
        const ratio = width / height || 9/16;
        setWidth(Math.round(val * ratio));
      }
    } else if (aspectRatioLock) {
      const ratio = width / height || 9/16;
      setWidth(Math.round(val * ratio));
    }
  };

  const handleSave = () => {
    if (window.electronAPI && window.electronAPI.applyProjectSettings) {
      window.electronAPI.applyProjectSettings({
        width,
        height,
        fps,
        brollLayout,
        brollX,
        brollY,
        brollWidth,
        brollHeight,
        brollAspectRatio
      });
    }
  };

  const handleCancel = () => {
    if (window.electronAPI && window.electronAPI.close) {
      // Since it's a child window, we can send close to close the settings window
      window.electronAPI.close();
    } else {
      window.close();
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', background: '#0a0a0f', color: '#fff' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '1.25rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Project Settings
      </h2>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Preset Select */}
        <div className="form-group">
          <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Preset Aspect Ratio</label>
          <select
            className="form-select"
            value={preset}
            onChange={handlePresetChange}
            style={{ width: '100%', padding: '10px', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
          >
            {ASPECT_RATIO_PRESETS.map((p, idx) => (
              <option key={idx} value={idx.toString()}>{p.name}</option>
            ))}
            <option value="custom">Custom Aspect Ratio</option>
          </select>
        </div>

        {/* Width / Height inputs */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Width (px)</label>
            <input
              type="number"
              className="form-input"
              value={width}
              onChange={handleWidthChange}
              style={{ width: '100%', padding: '10px', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
            />
          </div>
          
          {/* Lock Aspect Ratio Chain Icon */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '42px', paddingBottom: '2px', cursor: 'pointer', color: aspectRatioLock ? 'var(--accent-primary)' : 'var(--text-disabled)' }}
               onClick={() => setAspectRatioLock(!aspectRatioLock)}
               title={aspectRatioLock ? "Unlock Aspect Ratio" : "Lock Aspect Ratio"}>
            {aspectRatioLock ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="21" x2="3" y2="3"/><path d="M10.46 10.46a4 4 0 0 0 5.08 5.08L19 12a5 5 0 0 0-7.07-7.07l-1.47 1.47"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            )}
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>Height (px)</label>
            <input
              type="number"
              className="form-input"
              value={height}
              onChange={handleHeightChange}
              style={{ width: '100%', padding: '10px', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
            />
          </div>
        </div>

        {/* Framerate Input */}
        <div className="form-group" style={{ marginTop: '8px' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>Frame Rate</span>
            <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{fps} FPS</span>
          </label>
          <input
            type="range"
            min="24"
            max="60"
            step="1"
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value))}
            style={{ width: '100%', cursor: 'pointer', height: '6px', background: 'var(--surface-2)', borderRadius: '3px', outline: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-disabled)', marginTop: '6px' }}>
            <span>24 FPS</span>
            <span>30 FPS</span>
            <span>60 FPS</span>
          </div>
        </div>

        {/* B-Roll Overlay Window Layout */}
        <div className="form-group" style={{ marginTop: '16px' }}>
          <label className="form-label" style={{ marginBottom: '8px', display: 'block' }}>B-Roll Overlay Window (Optional)</label>
          <select
            className="form-select"
            value={brollLayout}
            onChange={(e) => setBrollLayout(e.target.value)}
            style={{ width: '100%', padding: '10px', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#fff' }}
          >
            <option value="none">None (Disabled)</option>
            <option value="split">Split-Screen (Top)</option>
            <option value="pip">Picture-in-Picture (Top)</option>
            <option value="custom">Custom Position & Size</option>
          </select>
        </div>

        {brollLayout !== 'none' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            marginTop: '14px',
            padding: '14px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--accent-primary, #00e5ff)' }}>Second Window Configuration</h4>
            
            {/* Aspect Ratio */}
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: '6px', display: 'block', fontSize: '11px', color: '#aaa' }}>Aspect Ratio</label>
              <select
                className="form-select"
                value={brollAspectRatio}
                onChange={(e) => handleBrollAspectRatioChange(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: '4px', color: '#fff', fontSize: '12px' }}
              >
                <option value="custom">Custom (Free Form)</option>
                <option value="16:9">Widescreen (16:9)</option>
                <option value="9:16">Portrait (9:16)</option>
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Standard (4:3)</option>
              </select>
            </div>

            {/* Width and Height */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', color: '#aaa' }}>
                  <span>Width</span>
                  <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>{brollWidth}%</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="0.5"
                  value={brollWidth}
                  onChange={(e) => handleBrollWidthChange(e.target.value)}
                  style={{ width: '100%', cursor: 'pointer', height: '4px', background: 'var(--surface-2)', borderRadius: '2px', outline: 'none' }}
                />
              </div>
              
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', color: '#aaa' }}>
                  <span>Height</span>
                  <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>{brollHeight}%</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="0.5"
                  value={brollHeight}
                  onChange={(e) => handleBrollHeightChange(e.target.value)}
                  style={{ width: '100%', cursor: 'pointer', height: '4px', background: 'var(--surface-2)', borderRadius: '2px', outline: 'none' }}
                />
              </div>
            </div>

            {/* Position X and Y */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', color: '#aaa' }}>
                  <span>Position X (Center)</span>
                  <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>{brollX}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={brollX}
                  onChange={(e) => setBrollX(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', cursor: 'pointer', height: '4px', background: 'var(--surface-2)', borderRadius: '2px', outline: 'none' }}
                />
              </div>
              
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px', color: '#aaa' }}>
                  <span>Position Y (Center)</span>
                  <span style={{ color: '#00e5ff', fontWeight: 'bold' }}>{brollY}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={brollY}
                  onChange={(e) => setBrollY(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', cursor: 'pointer', height: '4px', background: 'var(--surface-2)', borderRadius: '2px', outline: 'none' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', marginTop: 'auto' }}>
        <button
          className="btn btn--secondary"
          onClick={handleCancel}
          style={{ padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          style={{ padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}
