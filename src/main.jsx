import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0a0f',
          color: '#e3e3e8',
          fontFamily: 'Inter, sans-serif',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ color: '#ff6e6e', margin: 0, fontSize: 13 }}>
            {this.state.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#00e5ff',
              color: '#000',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const hash = window.location.hash;
const isVoiceCloneWindow = hash === '#/voice-clone';
const isSettingsWindow = hash === '#/settings';
const isGraphicsCreatorWindow = hash === '#/graphics-creator';

const App = React.lazy(() => import('./App'));
const VoiceCloneWindow = React.lazy(() => import('./VoiceCloneWindow'));
const ProjectSettingsWindow = React.lazy(() => import('./ProjectSettingsWindow'));
const GraphicsCreatorWindow = React.lazy(() => import('./GraphicsCreatorWindow'));

const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0a0a0f',
    color: '#555',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px'
  }}>
    Loading...
  </div>
);

const renderContent = () => {
  if (isVoiceCloneWindow) {
    return <VoiceCloneWindow />;
  }
  if (isSettingsWindow) {
    return <ProjectSettingsWindow />;
  }
  if (isGraphicsCreatorWindow) {
    return <GraphicsCreatorWindow />;
  }
  return <App />;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        {renderContent()}
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
