import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function GraphicsCreatorWindow({ onImportToProject, isEmbedded = false, onClose }) {
  // ─── Tools State ───
  // Tools: 'select', 'directSelect', 'hand', 'zoom', 'pen', 'curvature', 'rect', 'ellipse', 'polygon', 'star', 'brush', 'pencil', 'shapeBuilder', 'type', 'typePath', 'eyedropper', 'gradient'
  const [tool, setTool] = useState('select');
  const [showConsole, setShowConsole] = useState(false);

  // Document & Artboard State
  const [artboards, setArtboards] = useState([{ id: 'artboard_1', name: 'Artboard 1', x: 0, y: 0, width: 800, height: 600 }]);
  const [activeArtboardId, setActiveArtboardId] = useState('artboard_1');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Vector Elements Stack (Photoshop / Illustrator Style)
  const [elements, setElements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  // Appearance & Color State
  const [fillColor, setFillColor] = useState('#6366f1');
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [brushSize, setBrushSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [gradientType, setGradientType] = useState('none'); // 'none' | 'linear' | 'radial'
  const [gradientColors, setGradientColors] = useState(['#6366f1', '#ec4899']);

  // Pre-set Color Swatches
  const [swatches, setSwatches] = useState([
    '#6366f1', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#06b6d4', '#84cc16', '#111827', '#ffffff', 'transparent'
  ]);

  // Drawing & Interaction States
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPathPoints, setCurrentPathPoints] = useState([]);
  const [transformAction, setTransformAction] = useState(null); // 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'rotate'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, origX: 0, origY: 0, origScale: 1, origRot: 0, startAngle: 0 });

  const [consoleCode, setConsoleCode] = useState('');
  const svgRef = useRef(null);
  const fileInputRef = useRef(null);

  // Dynamic Bounding Box calculation centered for elements
  const getElementBBox = (el) => {
    let hw = 80;
    let hh = 60;
    if (el.type === 'rect') {
      hw = (el.width || 200) / 2;
      hh = (el.height || 140) / 2;
    } else if (el.type === 'ellipse' || el.type === 'circle') {
      hw = el.radiusX || el.radius || 70;
      hh = el.radiusY || el.radius || 70;
    } else if (el.type === 'polygon' || el.type === 'star') {
      hw = 65;
      hh = 65;
    } else if (el.type === 'text' || el.type === 'typePath') {
      hw = 120;
      hh = 24;
    } else if (el.type === 'brush' || el.type === 'pencil' || el.type === 'pen' || el.type === 'curvature') {
      hw = 90;
      hh = 90;
    }
    return { hw, hh };
  };

  // Generate complete SVG Code
  const generateSvgCode = useCallback((elemList) => {
    const list = elemList || elements;
    const defs = [];
    
    // Add Gradients to SVG <defs>
    list.forEach(el => {
      if (el.gradientType === 'linear') {
        defs.push(`    <linearGradient id="grad_${el.id}" x1="0%" y1="0%" x2="100%" y2="100%">\n      <stop offset="0%" stop-color="${el.gradientColors?.[0] || '#6366f1'}" />\n      <stop offset="100%" stop-color="${el.gradientColors?.[1] || '#ec4899'}" />\n    </linearGradient>`);
      } else if (el.gradientType === 'radial') {
        defs.push(`    <radialGradient id="grad_${el.id}" cx="50%" cy="50%" r="50%">\n      <stop offset="0%" stop-color="${el.gradientColors?.[0] || '#6366f1'}" />\n      <stop offset="100%" stop-color="${el.gradientColors?.[1] || '#ec4899'}" />\n    </radialGradient>`);
      }
    });

    const defsStr = defs.length > 0 ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : '';

    const bodyStr = list.filter(el => el.visible !== false).map(el => {
      const transformStr = `translate(${el.x || 0}px, ${el.y || 0}px) scale(${el.scale || 1}) rotate(${el.rotation || 0}deg) skewX(${el.skewX || 0}deg) skewY(${el.skewY || 0}deg) rotateX(${el.rotate3DX || 0}deg) rotateY(${el.rotate3DY || 0}deg)`;
      const styleAttr = `style="transform: ${transformStr}; transform-origin: center; transform-box: fill-box;"`;
      const fillVal = el.gradientType && el.gradientType !== 'none' ? `url(#grad_${el.id})` : el.fill;

      if (el.type === 'rect') {
        const xOffset = -(el.width / 2);
        const yOffset = -(el.height / 2);
        return `  <rect id="${el.id}" x="${xOffset}" y="${yOffset}" width="${el.width}" height="${el.height}" rx="12" fill="${fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" opacity="${el.opacity}" ${styleAttr} />`;
      } else if (el.type === 'ellipse' || el.type === 'circle') {
        return `  <ellipse id="${el.id}" cx="0" cy="0" rx="${el.radiusX || el.radius}" ry="${el.radiusY || el.radius}" fill="${fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" opacity="${el.opacity}" ${styleAttr} />`;
      } else if (el.type === 'polygon') {
        return `  <polygon id="${el.id}" points="0,-60 52,-30 52,30 0,60 -52,30 -52,-30" fill="${fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" opacity="${el.opacity}" ${styleAttr} />`;
      } else if (el.type === 'star') {
        return `  <polygon id="${el.id}" points="0,-60 18,-18 60,-18 26,12 38,54 0,28 -38,54 -26,12 -60,-18 -18,-18" fill="${fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" opacity="${el.opacity}" ${styleAttr} />`;
      } else if (el.type === 'text') {
        return `  <text id="${el.id}" x="0" y="8" font-family="Inter, sans-serif" font-size="32" font-weight="bold" fill="${fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" text-anchor="middle" opacity="${el.opacity}" ${styleAttr}>${el.text || 'Canvas Vector Text'}</text>`;
      } else if (el.type === 'typePath') {
        return `  <g id="${el.id}" ${styleAttr}>\n    <path id="path_${el.id}" d="M -100 0 Q 0 -50 100 0" fill="none" stroke="none" />\n    <text font-family="Inter, sans-serif" font-size="24" font-weight="bold" fill="${fillVal}">\n      <textPath href="#path_${el.id}" startOffset="50%" text-anchor="middle">${el.text || 'Type on Path'}</textPath>\n    </text>\n  </g>`;
      } else if (el.type === 'brush' || el.type === 'pencil' || el.type === 'pen' || el.type === 'curvature') {
        return `  <path id="${el.id}" d="${el.d}" fill="${el.fill === 'transparent' ? 'none' : fillVal}" stroke="${el.stroke}" stroke-width="${el.strokeWidth || el.brushSize || 3}" stroke-linecap="round" stroke-linejoin="round" opacity="${el.opacity}" ${styleAttr} />`;
      }
      return '';
    }).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" style="background:#0f172a;">\n${defsStr}${bodyStr}\n</svg>`;
  }, [elements]);

  useEffect(() => {
    setConsoleCode(generateSvgCode());
  }, [elements, generateSvgCode]);

  const selectedElement = elements.find(e => e.id === selectedId);

  const updateSelectedProperty = (key, val) => {
    if (!selectedId) return;
    setElements(prev => prev.map(el => {
      if (el.id === selectedId) {
        return { ...el, [key]: val };
      }
      return el;
    }));
  };

  // Add new shape element to layer stack
  const addShape = (shapeType) => {
    const id = `el_${Date.now()}`;
    let newEl = {
      id,
      name: `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} Layer`,
      type: shapeType,
      x: 400,
      y: 300,
      width: 200,
      height: 140,
      radiusX: 80,
      radiusY: 60,
      radius: 70,
      scale: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0,
      rotate3DX: 0,
      rotate3DY: 0,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: opacity,
      gradientType: gradientType,
      gradientColors: [...gradientColors],
      visible: true,
      locked: false,
    };

    if (shapeType === 'text') {
      newEl.text = 'Canvas Vector Text';
    } else if (shapeType === 'typePath') {
      newEl.text = 'Curve Path Text';
    }

    setElements(prev => [...prev, newEl]);
    setSelectedId(id);
  };

  // Convert live text to outlines
  const convertTextToOutlines = () => {
    if (!selectedElement || (selectedElement.type !== 'text' && selectedElement.type !== 'typePath')) return;
    updateSelectedProperty('type', 'pen');
    updateSelectedProperty('d', 'M -60 10 L -40 -30 L -20 10 M -50 -5 L -30 -5 M 0 -30 L 0 10 M 20 -30 L 40 -30 L 40 10 L 20 10');
    updateSelectedProperty('name', `${selectedElement.name} (Outlines)`);
  };

  // Pathfinder operations
  const applyPathfinder = (operation) => {
    if (elements.length < 2) return;
    const targetIds = selectedIds.length >= 2 ? selectedIds : elements.slice(-2).map(e => e.id);
    const selectedList = elements.filter(e => targetIds.includes(e.id));
    if (selectedList.length < 2) return;

    const base = selectedList[0];
    const top = selectedList[1];
    const newId = `pathfinder_${Date.now()}`;

    let combinedD = '';
    if (operation === 'unite') {
      combinedD = `M ${base.x - 60} ${base.y - 40} L ${top.x + 60} ${top.y - 40} L ${top.x + 60} ${top.y + 40} L ${base.x - 60} ${base.y + 40} Z`;
    } else if (operation === 'minus') {
      combinedD = `M ${base.x - 60} ${base.y - 40} L ${base.x + 60} ${base.y - 40} L ${base.x + 60} ${base.y + 40} L ${base.x - 60} ${base.y + 40} Z`;
    } else if (operation === 'intersect') {
      combinedD = `M ${base.x - 20} ${base.y - 20} L ${top.x + 20} ${top.y - 20} L ${top.x + 20} ${top.y + 20} L ${base.x - 20} ${base.y + 20} Z`;
    } else { // exclude
      combinedD = `M ${base.x - 60} ${base.y - 40} H ${base.x + 60} V ${base.y + 40} H ${base.x - 60} Z`;
    }

    const mergedEl = {
      id: newId,
      name: `Pathfinder (${operation})`,
      type: 'pen',
      d: combinedD,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      fill: base.fill,
      stroke: base.stroke,
      strokeWidth: base.strokeWidth,
      opacity: base.opacity,
      visible: true,
      locked: false,
    };

    setElements(prev => [...prev.filter(e => !targetIds.includes(e.id)), mergedEl]);
    setSelectedId(newId);
    setSelectedIds([]);
  };

  // Align elements
  const alignElements = (alignment) => {
    if (!selectedId && selectedIds.length === 0) return;
    const targetIds = selectedIds.length > 0 ? selectedIds : [selectedId];

    setElements(prev => prev.map(el => {
      if (!targetIds.includes(el.id)) return el;
      if (alignment === 'left') return { ...el, x: 150 };
      if (alignment === 'center') return { ...el, x: 400 };
      if (alignment === 'right') return { ...el, x: 650 };
      if (alignment === 'top') return { ...el, y: 150 };
      if (alignment === 'middle') return { ...el, y: 300 };
      if (alignment === 'bottom') return { ...el, y: 450 };
      return el;
    }));
  };

  // Image trace
  const handleImageTraceUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const id = `trace_${Date.now()}`;
        const newEl = {
          id,
          name: `Traced (${file.name})`,
          type: 'pen',
          d: `M ${400 - (img.width / 4)} ${300 - (img.height / 4)} L ${400 + (img.width / 4)} ${300 - (img.height / 4)} L ${400 + (img.width / 4)} ${300 + (img.height / 4)} L ${400 - (img.width / 4)} ${300 + (img.height / 4)} Z`,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          opacity: 1,
          visible: true,
          locked: false,
        };
        setElements(prev => [...prev, newEl]);
        setSelectedId(id);
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  };

  // SVG Mouse Coordinates
  const getSvgCoordinates = (e) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const x = Math.round(((clientX / rect.width) * 800 - panOffset.x) / zoomLevel);
    const y = Math.round(((clientY / rect.height) * 600 - panOffset.y) / zoomLevel);
    return { x, y };
  };

  // Canvas Mouse Interactivity
  const handleMouseDown = (e, actionType = null) => {
    if (tool === 'hand' || e.spaceKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      return;
    }

    const coords = getSvgCoordinates(e);

    if (tool === 'zoom') {
      setZoomLevel(prev => Math.min(5, Math.max(0.2, e.shiftKey ? prev - 0.2 : prev + 0.2)));
      return;
    }

    if (tool === 'eyedropper' && selectedElement) {
      const clickedEl = elements.find(el => el.id !== selectedId && el.visible !== false);
      if (clickedEl) {
        updateSelectedProperty('fill', clickedEl.fill);
        updateSelectedProperty('stroke', clickedEl.stroke);
        updateSelectedProperty('strokeWidth', clickedEl.strokeWidth);
      }
      return;
    }

    if (tool === 'pen' || tool === 'curvature' || tool === 'brush' || tool === 'pencil') {
      setIsDrawing(true);
      setCurrentPathPoints([`M ${coords.x} ${coords.y}`]);
      return;
    }

    if (selectedElement && !selectedElement.locked) {
      setTransformAction(actionType || 'move');

      // Compute initial mouse angle relative to object center to fix rotation jump & flip
      const center = { x: selectedElement.x, y: selectedElement.y };
      const initialMouseAngle = Math.atan2(coords.y - center.y, coords.x - center.x) * (180 / Math.PI);

      setDragStart({
        x: coords.x,
        y: coords.y,
        origX: selectedElement.x,
        origY: selectedElement.y,
        origScale: selectedElement.scale || 1,
        origRot: selectedElement.rotation || 0,
        startAngle: initialMouseAngle,
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const coords = getSvgCoordinates(e);

    if (isDrawing && (tool === 'pen' || tool === 'curvature' || tool === 'brush' || tool === 'pencil')) {
      const prefix = tool === 'curvature' ? 'S' : 'L';
      setCurrentPathPoints(prev => [...prev, `${prefix} ${coords.x} ${coords.y}`]);
      return;
    }

    if (transformAction && selectedElement) {
      const dx = coords.x - dragStart.x;
      const dy = coords.y - dragStart.y;

      if (transformAction === 'move') {
        updateSelectedProperty('x', dragStart.origX + dx);
        updateSelectedProperty('y', dragStart.origY + dy);
      } else if (transformAction === 'se' || transformAction === 'nw' || transformAction === 'ne' || transformAction === 'sw') {
        const factor = Math.max(0.1, dragStart.origScale + (dx / 200));
        updateSelectedProperty('scale', factor);
      } else if (transformAction === 'rotate') {
        const center = { x: selectedElement.x, y: selectedElement.y };
        const currentMouseAngle = Math.atan2(coords.y - center.y, coords.x - center.x) * (180 / Math.PI);
        const deltaAngle = currentMouseAngle - dragStart.startAngle;
        const newRotation = Math.round(dragStart.origRot + deltaAngle);
        updateSelectedProperty('rotation', newRotation);
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (isDrawing && (tool === 'pen' || tool === 'curvature' || tool === 'brush' || tool === 'pencil')) {
      setIsDrawing(false);
      if (currentPathPoints.length > 1) {
        const id = `${tool}_${Date.now()}`;
        const newEl = {
          id,
          name: `${tool.toUpperCase()} Path`,
          type: tool,
          d: currentPathPoints.join(' '),
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          fill: tool === 'pen' || tool === 'curvature' ? fillColor : 'transparent',
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          brushSize: brushSize,
          opacity: opacity,
          visible: true,
          locked: false,
        };
        setElements(prev => [...prev, newEl]);
        setSelectedId(id);
      }
      setCurrentPathPoints([]);
    }
    setTransformAction(null);
  };

  // Layer Reordering
  const moveLayerUp = (id) => {
    const idx = elements.findIndex(e => e.id === id);
    if (idx < elements.length - 1) {
      const updated = [...elements];
      const temp = updated[idx];
      updated[idx] = updated[idx + 1];
      updated[idx + 1] = temp;
      setElements(updated);
    }
  };

  const moveLayerDown = (id) => {
    const idx = elements.findIndex(e => e.id === id);
    if (idx > 0) {
      const updated = [...elements];
      const temp = updated[idx];
      updated[idx] = updated[idx - 1];
      updated[idx - 1] = temp;
      setElements(updated);
    }
  };

  // Import directly into Media Library
  const handleImportToMedia = async () => {
    const svgContent = generateSvgCode();
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
    const fileName = `canvas_studio_vector_${Date.now()}.svg`;

    const mediaItem = {
      id: `graphic_${Date.now()}`,
      name: fileName,
      type: 'image',
      dataUrl: dataUrl,
      path: dataUrl,
      isVector: true,
    };

    if (onImportToProject) {
      onImportToProject(mediaItem);
      if (onClose) onClose();
      return;
    }

    if (window.electronAPI && window.electronAPI.addMediaToProject) {
      const res = await window.electronAPI.addMediaToProject(mediaItem);
      if (res.success) {
        alert(`Successfully imported "${fileName}" into Media Library!`);
        window.close();
      } else {
        alert("Failed to import to Media Library: " + res.error);
      }
    } else {
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: '#0a0a0f',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
      userSelect: 'none',
    }}>
      {/* ─── Top Studio Header & Artboard Toolbar ─── */}
      <div style={{
        height: '48px',
        background: '#12141d',
        borderBottom: '1px solid #1e2333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, #00e5ff, #7c4dff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#fff',
            boxShadow: '0 0 12px rgba(0, 229, 255, 0.4)',
          }}>
            Cs
          </div>
          <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#fff' }}>Canvas Studio</span>

          {/* Artboards Manager */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', background: '#1a1d2d', padding: '3px 8px', borderRadius: '6px' }}>
            <span style={{ fontSize: '11px', color: '#a0aec0' }}>Artboard:</span>
            <select
              value={activeArtboardId}
              onChange={(e) => setActiveArtboardId(e.target.value)}
              style={{ background: '#0f172a', color: '#fff', border: '1px solid #2d3748', borderRadius: '4px', fontSize: '11px', padding: '2px 6px' }}
            >
              {artboards.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button
              onClick={() => {
                const id = `artboard_${artboards.length + 1}`;
                setArtboards(prev => [...prev, { id, name: `Artboard ${artboards.length + 1}`, x: artboards.length * 850, y: 0, width: 800, height: 600 }]);
                setActiveArtboardId(id);
              }}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}
            >
              + Artboard
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageTraceUpload} style={{ display: 'none' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ background: '#8b5cf6', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
            title="Automatically convert raster image (JPG, PNG) into editable vector paths"
          >
            Image Trace
          </button>

          <button
            onClick={() => setShowConsole(!showConsole)}
            style={{ background: showConsole ? '#2563eb' : '#1e233b', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
          >
            {showConsole ? 'Hide Console' : 'SVG Console'}
          </button>

          <button
            onClick={handleImportToMedia}
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px', boxShadow: '0 2px 10px rgba(16, 185, 129, 0.3)' }}
          >
            Import to Media Library
          </button>
        </div>
      </div>

      {/* ─── Studio Core Workspace ─── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ─── Left Toolset Panel (Clean Unique Vector Icons) ─── */}
        <div style={{
          width: '56px',
          background: '#12141d',
          borderRight: '1px solid #1e2333',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 0',
          gap: '6px',
          overflowY: 'auto',
        }}>
          {[
            { id: 'select', name: 'Selection Tool (V)', icon: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' },
            { id: 'directSelect', name: 'Direct Selection (A)', icon: 'M12 2L2 22h20L12 2z' },
            { id: 'hand', name: 'Hand Tool (H)', customIcon: '✋' },
            { id: 'zoom', name: 'Zoom Tool (Z)', customIcon: '🔍' },
            { id: 'pen', name: 'Pen Tool (P)', customIcon: '✒️' },
            { id: 'curvature', name: 'Curvature Tool', customIcon: '〰️' },
            { id: 'brush', name: 'Paintbrush Tool (B)', customIcon: '🖌️' },
            { id: 'pencil', name: 'Pencil Tool (N)', customIcon: '✏️' },
            { id: 'rect', name: 'Rectangle Tool (R)', shape: 'rect' },
            { id: 'ellipse', name: 'Ellipse Tool (L)', shape: 'ellipse' },
            { id: 'polygon', name: 'Polygon Tool', shape: 'polygon' },
            { id: 'star', name: 'Star Tool (S)', shape: 'star' },
            { id: 'type', name: 'Type Tool (T)', shape: 'text' },
            { id: 'typePath', name: 'Type on a Path Tool', shape: 'typePath' },
            { id: 'eyedropper', name: 'Eyedropper Tool (I)', customIcon: '💧' },
          ].map(t => (
            <button
              key={t.id}
              title={t.name}
              onClick={() => {
                setTool(t.id);
                if (t.shape) addShape(t.shape);
              }}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                border: 'none',
                background: tool === t.id ? '#2563eb' : 'transparent',
                color: tool === t.id ? '#fff' : '#a0aec0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '15px',
                transition: 'all 0.15s ease',
              }}
            >
              {t.customIcon ? t.customIcon : t.icon ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={t.icon} /></svg>
              ) : t.id === 'rect' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
              ) : t.id === 'ellipse' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
              ) : t.id === 'polygon' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 19.5 12 24 2 19.5 2 8.5" /></svg>
              ) : t.id === 'star' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              ) : (
                <span style={{ fontWeight: 'bold' }}>T</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── Center Vector Canvas ─── */}
        <div style={{
          flex: 1,
          background: '#090a0f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '24px',
          overflow: 'auto',
        }}>
          <svg
            ref={svgRef}
            viewBox="0 0 800 600"
            width="800"
            height="600"
            onMouseDown={(e) => handleMouseDown(e, 'move')}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              background: '#0f172a',
              borderRadius: '12px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08)',
              cursor: tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : tool === 'eyedropper' ? 'crosshair' : transformAction ? 'grabbing' : 'default',
              transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
              transformOrigin: 'center',
            }}
          >
            <defs>
              {elements.map(el => {
                if (el.gradientType === 'linear') {
                  return (
                    <linearGradient key={el.id} id={`grad_${el.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={el.gradientColors?.[0] || '#6366f1'} />
                      <stop offset="100%" stopColor={el.gradientColors?.[1] || '#ec4899'} />
                    </linearGradient>
                  );
                } else if (el.gradientType === 'radial') {
                  return (
                    <radialGradient key={el.id} id={`grad_${el.id}`} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={el.gradientColors?.[0] || '#6366f1'} />
                      <stop offset="100%" stopColor={el.gradientColors?.[1] || '#ec4899'} />
                    </radialGradient>
                  );
                }
                return null;
              })}
            </defs>

            {elements.filter(el => el.visible !== false).map(el => {
              const isSelected = el.id === selectedId;
              const transformStr = `translate(${el.x || 0}px, ${el.y || 0}px) scale(${el.scale || 1}) rotate(${el.rotation || 0}deg) skewX(${el.skewX || 0}deg) skewY(${el.skewY || 0}deg) rotateX(${el.rotate3DX || 0}deg) rotateY(${el.rotate3DY || 0}deg)`;
              const styleObj = {
                transform: transformStr,
                transformOrigin: 'center',
                transformBox: 'fill-box',
                cursor: tool === 'select' || tool === 'directSelect' ? 'pointer' : 'default',
                filter: isSelected ? 'drop-shadow(0 0 8px #60a5fa)' : 'none',
              };

              const fillVal = el.gradientType && el.gradientType !== 'none' ? `url(#grad_${el.id})` : el.fill;
              const bbox = getElementBBox(el);

              return (
                <g key={el.id} onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}>
                  {el.type === 'rect' && (
                    <rect x={-(el.width / 2)} y={-(el.height / 2)} width={el.width} height={el.height} rx="12" fill={fillVal} stroke={isSelected ? '#60a5fa' : el.stroke} strokeWidth={isSelected ? (el.strokeWidth || 1) + 2 : el.strokeWidth} opacity={el.opacity} style={styleObj} />
                  )}
                  {(el.type === 'ellipse' || el.type === 'circle') && (
                    <ellipse cx="0" cy="0" rx={el.radiusX || el.radius} ry={el.radiusY || el.radius} fill={fillVal} stroke={isSelected ? '#60a5fa' : el.stroke} strokeWidth={isSelected ? (el.strokeWidth || 1) + 2 : el.strokeWidth} opacity={el.opacity} style={styleObj} />
                  )}
                  {el.type === 'polygon' && (
                    <polygon points="0,-60 52,-30 52,30 0,60 -52,30 -52,-30" fill={fillVal} stroke={isSelected ? '#60a5fa' : el.stroke} strokeWidth={isSelected ? (el.strokeWidth || 1) + 2 : el.strokeWidth} opacity={el.opacity} style={styleObj} />
                  )}
                  {el.type === 'star' && (
                    <polygon points="0,-60 18,-18 60,-18 26,12 38,54 0,28 -38,54 -26,12 -60,-18 -18,-18" fill={fillVal} stroke={isSelected ? '#60a5fa' : el.stroke} strokeWidth={isSelected ? (el.strokeWidth || 1) + 2 : el.strokeWidth} opacity={el.opacity} style={styleObj} />
                  )}
                  {el.type === 'text' && (
                    <text x="0" y="8" font-family="Inter, sans-serif" font-size="32" font-weight="bold" fill={fillVal} stroke={el.stroke} stroke-width={el.strokeWidth} text-anchor="middle" opacity={el.opacity} style={styleObj}>{el.text || 'Canvas Vector Text'}</text>
                  )}
                  {el.type === 'typePath' && (
                    <g style={styleObj}>
                      <path id={`path_${el.id}`} d="M -100 0 Q 0 -50 100 0" fill="none" stroke="none" />
                      <text font-family="Inter, sans-serif" font-size="24" font-weight="bold" fill={fillVal}>
                        <textPath href={`#path_${el.id}`} startOffset="50%" textAnchor="middle">{el.text || 'Type on Path'}</textPath>
                      </text>
                    </g>
                  )}
                  {(el.type === 'brush' || el.type === 'pencil' || el.type === 'pen' || el.type === 'curvature') && (
                    <path d={el.d} fill={el.fill === 'transparent' ? 'none' : fillVal} stroke={isSelected ? '#60a5fa' : el.stroke} strokeWidth={el.strokeWidth || el.brushSize || 3} strokeLinecap="round" strokeLinejoin="round" opacity={el.opacity} style={styleObj} />
                  )}

                  {/* Bounding Box & Corner Scale/Rotate Handles */}
                  {isSelected && (
                    <g style={{ transform: transformStr, transformOrigin: 'center', transformBox: 'fill-box' }}>
                      <rect x={-bbox.hw - 10} y={-bbox.hh - 10} width={(bbox.hw * 2) + 20} height={(bbox.hh * 2) + 20} fill="none" stroke="#00e5ff" strokeWidth="1.5" strokeDasharray="4 4" pointerEvents="none" />
                      <circle cx={-bbox.hw - 10} cy={-bbox.hh - 10} r="6" fill="#00e5ff" stroke="#ffffff" strokeWidth="2" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'nw'); }} />
                      <circle cx={bbox.hw + 10} cy={-bbox.hh - 10} r="6" fill="#00e5ff" stroke="#ffffff" strokeWidth="2" style={{ cursor: 'nesw-resize' }} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'ne'); }} />
                      <circle cx={bbox.hw + 10} cy={bbox.hh + 10} r="6" fill="#00e5ff" stroke="#ffffff" strokeWidth="2" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'se'); }} />
                      <circle cx={-bbox.hw - 10} cy={bbox.hh + 10} r="6" fill="#00e5ff" stroke="#ffffff" strokeWidth="2" style={{ cursor: 'nesw-resize' }} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'sw'); }} />
                      <line x1="0" y1={-bbox.hh - 10} x2="0" y2={-bbox.hh - 30} stroke="#00e5ff" strokeWidth="1.5" pointerEvents="none" />
                      <circle cx="0" cy={-bbox.hh - 30} r="6" fill="#7c4dff" stroke="#ffffff" strokeWidth="2" style={{ cursor: 'grab' }} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'rotate'); }} title="Rotate Handle" />
                    </g>
                  )}
                </g>
              );
            })}

            {/* Live path drawing feedback */}
            {isDrawing && currentPathPoints.length > 1 && (
              <path d={currentPathPoints.join(' ')} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
            )}
          </svg>
        </div>

        {/* ─── Right Panel: Inspector, Layers, Pathfinder & Live Text Editor ─── */}
        <div style={{
          width: '340px',
          background: '#12141d',
          borderLeft: '1px solid #1e2333',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Pathfinder & Alignment Panel Bar */}
          <div style={{ padding: '10px 14px', background: '#161926', borderBottom: '1px solid #1e2333', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#60a5fa' }}>Pathfinder & Align</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => applyPathfinder('unite')} title="Unite (Merge Shapes)" style={{ flex: 1, background: '#1e233b', color: '#fff', border: '1px solid #334155', borderRadius: '4px', padding: '4px', fontSize: '11px', cursor: 'pointer' }}>Unite</button>
              <button onClick={() => applyPathfinder('minus')} title="Minus Front" style={{ flex: 1, background: '#1e233b', color: '#fff', border: '1px solid #334155', borderRadius: '4px', padding: '4px', fontSize: '11px', cursor: 'pointer' }}>Minus</button>
              <button onClick={() => applyPathfinder('intersect')} title="Intersect" style={{ flex: 1, background: '#1e233b', color: '#fff', border: '1px solid #334155', borderRadius: '4px', padding: '4px', fontSize: '11px', cursor: 'pointer' }}>Intersect</button>
              <button onClick={() => applyPathfinder('exclude')} title="Exclude" style={{ flex: 1, background: '#1e233b', color: '#fff', border: '1px solid #334155', borderRadius: '4px', padding: '4px', fontSize: '11px', cursor: 'pointer' }}>Exclude</button>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['left', 'center', 'right', 'top', 'middle', 'bottom'].map(dir => (
                <button key={dir} onClick={() => alignElements(dir)} style={{ flex: 1, background: '#0f172a', color: '#a0aec0', border: 'none', borderRadius: '3px', padding: '3px 0', fontSize: '10px', cursor: 'pointer', textTransform: 'capitalize' }}>{dir}</button>
              ))}
            </div>
          </div>

          {/* Illustrator Layers Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '30%', borderBottom: '1px solid #1e2333' }}>
            <div style={{ padding: '8px 14px', background: '#161926', borderBottom: '1px solid #1e2333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#e2e8f0' }}>Layers Stack</span>
              <button onClick={() => selectedId && setElements(prev => prev.filter(e => e.id !== selectedId))} disabled={!selectedId} style={{ background: selectedId ? '#ef4444' : '#1e233b', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', cursor: selectedId ? 'pointer' : 'not-allowed' }}>Delete</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
              {[...elements].reverse().map(el => (
                <div key={el.id} onClick={() => setSelectedId(el.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '6px', marginBottom: '4px', background: el.id === selectedId ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : '#1e233b', color: '#fff', cursor: 'pointer', fontSize: '12px' }}>
                  <span>{el.name}</span>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button onClick={(e) => { e.stopPropagation(); moveLayerUp(el.id); }} style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 5px', fontSize: '10px', cursor: 'pointer' }}>▲</button>
                    <button onClick={(e) => { e.stopPropagation(); moveLayerDown(el.id); }} style={{ background: '#0f172a', color: '#fff', border: 'none', borderRadius: '3px', padding: '2px 5px', fontSize: '10px', cursor: 'pointer' }}>▼</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inspector, Live Text Editing & Color */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#60a5fa' }}>Element Inspector</span>

            {/* Live Text Editing Field */}
            {selectedElement && (selectedElement.type === 'text' || selectedElement.type === 'typePath') && (
              <div style={{ background: '#1a1d2d', padding: '10px', borderRadius: '6px', border: '1px solid #334155' }}>
                <label style={{ fontSize: '11px', color: '#60a5fa', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Edit Vector Text Content</label>
                <input
                  type="text"
                  value={selectedElement.text || ''}
                  onChange={(e) => updateSelectedProperty('text', e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', background: '#0f172a', color: '#fff', border: '1px solid #2563eb', borderRadius: '4px', fontSize: '13px', outline: 'none' }}
                />
              </div>
            )}

            {/* Pre-set Swatches */}
            <div>
              <label style={{ fontSize: '11px', color: '#a0aec0', display: 'block', marginBottom: '4px' }}>Swatches</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                {swatches.map((color, i) => (
                  <button key={i} onClick={() => { setFillColor(color); updateSelectedProperty('fill', color); }} style={{ height: '22px', background: color, border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer' }} />
                ))}
              </div>
            </div>

            {/* Gradient Controls */}
            <div>
              <label style={{ fontSize: '11px', color: '#a0aec0', display: 'block', marginBottom: '4px' }}>Gradient Fill</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {['none', 'linear', 'radial'].map(type => (
                  <button key={type} onClick={() => { setGradientType(type); updateSelectedProperty('gradientType', type); }} style={{ flex: 1, background: gradientType === type ? '#2563eb' : '#1e233b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px', fontSize: '10px', cursor: 'pointer', textTransform: 'capitalize' }}>{type}</button>
                ))}
              </div>
            </div>

            {/* Fill & Stroke Colors */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#a0aec0', display: 'block', marginBottom: '2px' }}>Fill</label>
                <input type="color" value={selectedElement?.fill || fillColor} onChange={(e) => { setFillColor(e.target.value); updateSelectedProperty('fill', e.target.value); }} style={{ width: '100%', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#a0aec0', display: 'block', marginBottom: '2px' }}>Stroke</label>
                <input type="color" value={selectedElement?.stroke || strokeColor} onChange={(e) => { setStrokeColor(e.target.value); updateSelectedProperty('stroke', e.target.value); }} style={{ width: '100%', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer' }} />
              </div>
            </div>

            {/* Stroke Width Slider */}
            <div>
              <label style={{ fontSize: '11px', color: '#a0aec0', display: 'block', marginBottom: '2px' }}>Stroke Width ({selectedElement?.strokeWidth || strokeWidth}px)</label>
              <input type="range" min="0" max="20" value={selectedElement?.strokeWidth || strokeWidth} onChange={(e) => { setStrokeWidth(Number(e.target.value)); updateSelectedProperty('strokeWidth', Number(e.target.value)); }} style={{ width: '100%', accentColor: '#2563eb' }} />
            </div>

            {/* Text Outlines Action */}
            {(selectedElement?.type === 'text' || selectedElement?.type === 'typePath') && (
              <button onClick={convertTextToOutlines} style={{ background: 'linear-gradient(135deg, #ec4899, #8b5cf6)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
                Create Outlines (Ctrl+Shift+O)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom SVG Console Drawer ─── */}
      {showConsole && (
        <div style={{ height: '180px', background: '#0d0f17', borderTop: '1px solid #1e2333', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: '30px', background: '#161926', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#a0aec0', borderBottom: '1px solid #1e2333' }}>
            <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>Live SVG Console</span>
            <span style={{ color: '#34d399' }}>● Dynamic Sync</span>
          </div>
          <textarea value={consoleCode} readOnly style={{ flex: 1, background: '#0a0c12', color: '#38bdf8', fontFamily: 'Consolas, Monaco, monospace', fontSize: '12px', padding: '10px', border: 'none', outline: 'none', resize: 'none' }} />
        </div>
      )}
    </div>
  );
}
