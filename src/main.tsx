import React, { useEffect } from 'react';
import { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button, 
  TextField, 
  Box, 
  Typography, 
  Paper, 
  InputLabel, 
  Select, 
  MenuItem, 
  FormControlLabel, 
  Switch, 
  Chip, 
  FormControl, 
  Tooltip, 
  IconButton, 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  ThemeProvider, 
  createTheme, 
  CssBaseline
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';

type ElectronAPI = {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  isElectron: boolean;
  ipcRenderer?: {
    on: (channel: string, listener: (event: any, data: any) => void) => void;
    removeAllListeners: (channel: string) => void;
  };
};

declare global {
  var electron: ElectronAPI;
}

// Improved Electron detection
const isElectron = () => {
  try {
    return typeof window !== 'undefined' && 
           window.electron !== undefined && 
           window.electron.isElectron === true;
  } catch (e) {
    console.error('Error checking for Electron:', e);
    return false;
  }
};

// Add detectSelectorType function
function detectSelectorType(selector: string): string {
  if (selector.startsWith('/') || selector.startsWith('./') || selector.startsWith('//')) {
    return 'xpath';
  } else if (selector.startsWith('document.') || selector.includes('querySelector') || selector.includes('getElement')) {
    return 'js';
  } else {
    return 'css';
  }
}

function App() {
  const [proxies, setProxies] = useState<string[]>([]);
  const [proxyInput, setProxyInput] = useState('');
  const [url, setUrl] = useState('https://futuretech.my.id');
  const [parallel, setParallel] = useState(3);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);
  const [fetchingProxies, setFetchingProxies] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [proxyLogs, setProxyLogs] = useState<string[]>([]);
  const [automationLogs, setAutomationLogs] = useState<string[]>([]);
  const [proxyProgress, setProxyProgress] = useState<{current: number, total: number} | null>(null);
  const [cacheStatus, setCacheStatus] = useState<{totalCached: number, lastUpdated: string | null}>({ totalCached: 0, lastUpdated: null });
  const [noProxy, setNoProxy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [customSelectors, setCustomSelectors] = useState<string[]>([]);
  const [newSelector, setNewSelector] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const automationLogRef = useRef<HTMLDivElement>(null);
  const [visitDelay, setVisitDelay] = useState(0); // 0 for random, >0 for fixed seconds
  const [clickDelay, setClickDelay] = useState(0); // 0 for random, >0 for fixed seconds
  const [closeDelay, setCloseDelay] = useState(0); // 0 for random, >0 for fixed seconds
  const [randomClicks, setRandomClicks] = useState(true); // Enable random clicks before ads
  const [minRandomClicks, setMinRandomClicks] = useState(1); // Minimum random clicks
  const [maxRandomClicks, setMaxRandomClicks] = useState(3); // Maximum random clicks
  const [minScrollDuration, setMinScrollDuration] = useState(2); // Minimum scroll duration in seconds
  const [maxScrollDuration, setMaxScrollDuration] = useState(5); // Maximum scroll duration in seconds
  const [proxyProvider, setProxyProvider] = useState('default'); // default, custom
  const [fingerprintProvider, setFingerprintProvider] = useState('default'); // default, local, custom
  const [customProxyProvider, setCustomProxyProvider] = useState('');
  const [customFingerprintProvider, setCustomFingerprintProvider] = useState('');
  const [browserType, setBrowserType] = useState('chrome'); // chrome, firefox
  const [stealthMode, setStealthMode] = useState(true);
  const [headlessMode, setHeadlessMode] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [targetImpressions, setTargetImpressions] = useState(1);
  const [targetClicks, setTargetClicks] = useState(0);
  const [isUrlList, setIsUrlList] = useState(false);
  const [urlListInput, setUrlListInput] = useState('');

  // Create theme based on dark mode
  const theme = createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
    },
  });

  useEffect(() => {
    if (!isElectron()) return;
    const ipcRenderer = window.electron.ipcRenderer;
    if (!ipcRenderer) return;
    
    // Listen for close dialog event
    const handleShowCloseDialog = () => {
      console.log('[Renderer] Received show-close-dialog event');
      setShowCloseDialog(true);
    };

    ipcRenderer.on('show-close-dialog', handleShowCloseDialog);

    // Listen for proxy logs
    ipcRenderer.on('proxy-log', (_event: any, data: any) => {
      if (data.message) setProxyLogs(logs => [...logs, data.message]);
      if (data.progress) setProxyProgress(data.progress);
    });

    // Listen for automation logs
    ipcRenderer.on('automation-log', (_event: any, data: any) => {
      if (data.message) setAutomationLogs(logs => [...logs, data.message]);
    });

    return () => {
      ipcRenderer.removeAllListeners('show-close-dialog');
      ipcRenderer.removeAllListeners('proxy-log');
      ipcRenderer.removeAllListeners('automation-log');
    };
  }, []);

  useEffect(() => {
    // Auto-scroll log windows
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
    if (automationLogRef.current) {
      automationLogRef.current.scrollTop = automationLogRef.current.scrollHeight;
    }
  }, [proxyLogs, automationLogs]);

  useEffect(() => {
    if (!isElectron()) return;
    // Get initial cache status
    window.electron.invoke('get-cache-status').then(status => {
      setCacheStatus(status);
    });
  }, []);

  const addProxyLines = (lines: string) => {
    const ps = lines.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    setProxies(pr => [...pr, ...ps]);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const reader = new FileReader();
    reader.onload = r => addProxyLines(reader.result as string);
    reader.readAsText(e.target.files[0]);
  };

  const handleAddSelector = () => {
    if (newSelector.trim()) {
      setCustomSelectors(prev => [...prev, newSelector.trim()]);
      setNewSelector('');
    }
  };

  const handleRemoveSelector = (index: number) => {
    setCustomSelectors(prev => prev.filter((_, i) => i !== index));
  };

  const handleStart = async () => {
    setRunning(true); 
    setResults([]); 
    setProgress(0); 
    setProxyProgress(null);
    
    const urlsToVisit = isUrlList 
      ? urlListInput.split(',').map(url => url.trim()).filter(url => url) 
      : [url];

    try {
      const res = await window.electron.invoke('start-visits', {
        proxies,
        urls: urlsToVisit,
        parallel,
        customSelectors,
        delays: {
          visit: visitDelay,
          click: clickDelay,
          close: closeDelay
        },
        randomClicks: {
          enabled: randomClicks,
          min: minRandomClicks,
          max: maxRandomClicks
        },
        scrollDuration: {
          min: minScrollDuration,
          max: maxScrollDuration
        },
        providers: {
          proxy: proxyProvider === 'custom' ? customProxyProvider : 'default',
          fingerprint: fingerprintProvider === 'custom' ? customFingerprintProvider : 'default'
        },
        browser: browserType,
        stealth: stealthMode,
        headless: headlessMode,
        targetImpressions,
        targetClicks,
      });
      setResults(res);
      setProgress(100);
    } catch (error) {
      let msg = '';
      if (error instanceof Error) {
        msg = error.message;
      } else if (typeof error === 'string') {
        msg = error;
      } else {
        msg = JSON.stringify(error);
      }
      setAutomationLogs(logs => [...logs, `Error: ${msg}`]);
      setResults([]);
      setProgress(0);
    } finally {
      setRunning(false);
    }
  };

  const handleStop = async () => {
    if (isElectron()) {
      try {
        // Disable both start and stop buttons during stopping process
        setRunning(true);
        setAutomationLogs(logs => [...logs, 'Stopping automation...']);
        
        // Call stop automation with a timeout
        const stopTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Stop timeout')), 35000)
        );
        
        await Promise.race([
          window.electron.invoke('stop-automation'),
          stopTimeout
        ]);
        
        // Reset UI state after stop completes
        setRunning(false);
        setAutomationLogs(logs => [...logs, 'Automation stopped successfully']);
        setProgress(0);
        setProxyProgress(null);
      } catch (error: any) {
        console.error('Error stopping automation:', error);
        setAutomationLogs(logs => [...logs, `Error stopping automation: ${error.message}`]);
        // Reset UI state even if stop failed
        setRunning(false);
        setProgress(0);
        setProxyProgress(null);
      }
    }
  };

  // Add effect to handle stop events
  useEffect(() => {
    if (!isElectron()) return;
    const ipcRenderer = window.electron.ipcRenderer;
    if (!ipcRenderer) return;

    const handleStopEvent = () => {
      setRunning(false);
      setProgress(0);
      setProxyProgress(null);
      setAutomationLogs(logs => [...logs, 'Automation stopped by system']);
    };

    ipcRenderer.on('automation-stopped', handleStopEvent);

    return () => {
      ipcRenderer.removeAllListeners('automation-stopped');
    };
  }, []);

  const handleClear = () => { 
    setProxies([]); 
    setResults([]); 
    setProgress(0); 
    setProxyLogs([]); 
    setAutomationLogs([]);
    setProxyProgress(null); 
  };

  const handleFetchProxies = async (useCached = false) => {
    setFetchingProxies(true);
    setFetchError(null);
    setProxyLogs([]);
    setProxyProgress(null);
    try {
      const fetched = await window.electron.invoke('fetch-proxies', { count: parallel, useCached });
      if (Array.isArray(fetched) && fetched.length > 0) {
        // Add new proxies to existing ones instead of replacing
        setProxies(current => {
          const newProxies = fetched.map(p => typeof p === 'string' ? p : p.proxy || p.string || '');
          const combined = [...current, ...newProxies];
          // Remove duplicates
          return [...new Set(combined)];
        });
        setProxyLogs(logs => [...logs, `Successfully loaded ${fetched.length} ${useCached ? 'cached' : 'new'} proxies`]);
        
        // Update cache status
        const status = await window.electron.invoke('get-cache-status');
        setCacheStatus(status);
      } else if (fetched && fetched.error) {
        setFetchError(fetched.error);
      } else {
        setFetchError('No proxies found. Please try again.');
      }
    } catch (e: any) {
      setFetchError(e?.message || 'Failed to fetch proxies.');
    }
    setFetchingProxies(false);
  };

  // Handle close confirmation
  const handleCloseConfirm = async () => {
    console.log('[Renderer] Confirming close');
    if (isElectron()) {
      try {
        await window.electron.invoke('confirm-close');
      } catch (error) {
        console.error('[Renderer] Error closing app:', error);
      }
    }
  };

  const handleCloseCancel = async () => {
    console.log('[Renderer] Cancelling close');
    if (isElectron()) {
      try {
        await window.electron.invoke('cancel-close');
        setShowCloseDialog(false);
      } catch (error) {
        console.error('[Renderer] Error cancelling close:', error);
      }
    }
  };

  if (!isElectron()) {
    console.log('Not running in Electron environment');
    return (
      <Box p={3}>
        <Typography variant="h4" color="error" gutterBottom>
          This app must be run inside Electron.<br/>
          Please use the provided Electron launcher, not a web browser.
        </Typography>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box p={3} sx={{ maxWidth: 1200, margin: '0 auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Typography variant="h4" gutterBottom sx={{ textAlign: 'center' }}>
            Browser Visit & Ad Bomber
          </Typography>
          <Tooltip title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}>
            <IconButton onClick={() => setDarkMode(!darkMode)} color="inherit">
              {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>
        </Box>
        {/* Enhanced Main Settings Grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(4, 1fr)'
          },
          gap: 3,
          mb: 3
        }}>
          {/* Target Settings */}
          <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 320 }}>
            <Typography variant="h6" gutterBottom>Target Settings</Typography>
            {/* URL Input Section */}
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={isUrlList}
                    onChange={e => setIsUrlList(e.target.checked)}
                  />
                }
                label={isUrlList ? 'URL List' : 'Single URL'}
              />
              {isUrlList ? (
                <TextField
                  fullWidth
                  size="small"
                  label="Target URLs (comma separated)"
                  value={urlListInput}
                  onChange={e => setUrlListInput(e.target.value)}
                  placeholder="https://site1.com, https://site2.com"
                  sx={{ mt: 1 }}
                />
              ) : (
                <TextField
                  fullWidth
                  size="small"
                  label="Target URL"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  sx={{ mt: 1 }}
                />
              )}
            </Box>
            {/* Impressions and Clicks */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                size="small"
                type="number"
                label="Target Impressions"
                value={targetImpressions}
                onChange={e => setTargetImpressions(Math.max(1, parseInt(e.target.value) || 1))}
                InputProps={{ inputProps: { min: 1 } }}
                sx={{ flex: 1 }}
                helperText="Visits per URL"
              />
              <TextField
                size="small"
                type="number"
                label="Target Clicks"
                value={targetClicks}
                onChange={e => setTargetClicks(Math.max(0, parseInt(e.target.value) || 0))}
                InputProps={{ inputProps: { min: 0 } }}
                sx={{ flex: 1 }}
                helperText="Ad clicks per visit"
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel sx={{display:'flex', alignItems:'center', gap:0.5}}>
                  Browser Type
                  <Tooltip title="Select the browser to use for automation"><InfoOutlinedIcon fontSize="small"/></Tooltip>
                </InputLabel>
                <Select
                  value={browserType}
                  onChange={(e) => setBrowserType(e.target.value)}
                  label="Browser Type"
                >
                  <MenuItem value="chrome">Chrome</MenuItem>
                  <MenuItem value="firefox">Firefox</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{display:'flex', alignItems:'center', gap:2, mb:2}}>
              <FormControlLabel
                control={
                  <Switch
                    checked={stealthMode}
                    onChange={e => setStealthMode(e.target.checked)}
                  />
                }
                label={
                  <Box sx={{display:'flex', alignItems:'center', gap:0.5}}>
                    Stealth Mode
                    <Tooltip title="Enable stealth mode to avoid detection"><InfoOutlinedIcon fontSize="small"/></Tooltip>
                  </Box>
                }
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={headlessMode}
                    onChange={e => {
                      setHeadlessMode(e.target.checked);
                      setAutomationLogs(logs => [...logs, `Headless mode ${e.target.checked ? 'enabled' : 'disabled'}`]);
                    }}
                  />
                }
                label={
                  <Box sx={{display:'flex', alignItems:'center', gap:0.5}}>
                    Headless Mode
                    <Tooltip title="Run browsers in headless mode (no visible window)"><InfoOutlinedIcon fontSize="small"/></Tooltip>
                  </Box>
                }
              />
            </Box>
            <Box sx={{display:'flex', alignItems:'center', gap:2}}>
              <Box>
                <InputLabel sx={{display:'flex', alignItems:'center', gap:0.5}}>
                  Concurrency
                  <Tooltip title="How many browsers to run in parallel."><InfoOutlinedIcon fontSize="small"/></Tooltip>
                </InputLabel>
                <Select 
                  value={parallel} 
                  onChange={e=>setParallel(Number(e.target.value))} 
                  sx={{ width:100 }}
                >
                  {[1,2,3,5,10,20,30].map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flex: 1 }}>
                <Tooltip title="Start the automation with the above settings.">
                  <span>
                    <Button 
                      onClick={handleStart} 
                      variant="contained" 
                      color="success" 
                      disabled={running || (proxies.length===0 && !noProxy) || fetchingProxies}
                      sx={{ flex: 1 }}
                    >
                      {running ? 'Running...' : 'Start'}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Stop the current automation process.">
                  <span>
                    <Button 
                      onClick={handleStop} 
                      variant="contained" 
                      color="error" 
                      disabled={!running}
                      sx={{ flex: 1 }}
                    >
                      Stop
                    </Button>
                  </span>
                </Tooltip>
              </Box>
            </Box>
          </Paper>

          {/* Delay Settings */}
          <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 320 }}>
            <Box sx={{display:'flex', alignItems:'center', gap:1}}>
              <Typography variant="h6" gutterBottom>Delay Settings</Typography>
              <Tooltip title="Set delays between actions. 0 = random, >0 = fixed."><InfoOutlinedIcon fontSize="small"/></Tooltip>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{mb:2, display: 'block'}}>
              Set delay times in seconds (0 for random)
            </Typography>
            <Box sx={{display: 'flex', flexDirection: 'column', gap: 2, flex: 1}}>
              <Tooltip title="Delay after page loads before clicking ads. 0 = random 30-60s.">
                <TextField
                  size="small"
                  type="number"
                  label="Visit Delay"
                  value={visitDelay}
                  onChange={(e) => setVisitDelay(Math.max(0, parseInt(e.target.value) || 0))}
                  InputProps={{ inputProps: { min: 0 } }}
                  helperText={visitDelay === 0 ? "Random 30-60s" : "Fixed delay"}
                  sx={{ mb: 1 }}
                />
              </Tooltip>
              <Tooltip title="Delay between ad clicks. 0 = random 1-3s.">
                <TextField
                  size="small"
                  type="number"
                  label="Click Delay"
                  value={clickDelay}
                  onChange={(e) => setClickDelay(Math.max(0, parseInt(e.target.value) || 0))}
                  InputProps={{ inputProps: { min: 0 } }}
                  helperText={clickDelay === 0 ? "Random 1-3s" : "Fixed delay"}
                  sx={{ mb: 1 }}
                />
              </Tooltip>
              <Tooltip title="Delay before closing the browser. 0 = random 1-3s.">
                <TextField
                  size="small"
                  type="number"
                  label="Close Delay"
                  value={closeDelay}
                  onChange={(e) => setCloseDelay(Math.max(0, parseInt(e.target.value) || 0))}
                  InputProps={{ inputProps: { min: 0 } }}
                  helperText={closeDelay === 0 ? "Random 1-3s" : "Fixed delay"}
                />
              </Tooltip>
            </Box>
          </Paper>

          {/* Random Behavior Settings */}
          <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 320 }}>
            <Box sx={{display:'flex', alignItems:'center', gap:1, mb: 1}}>
              <Typography variant="h6" gutterBottom>Random Behavior</Typography>
              <Tooltip title="Configure random behaviors to make automation more human-like"><InfoOutlinedIcon fontSize="small"/></Tooltip>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={randomClicks}
                  onChange={(e) => setRandomClicks(e.target.checked)}
                />
              }
              label={
                <Box sx={{display:'flex', alignItems:'center', gap:0.5}}>
                  Random Clicks
                  <Tooltip title="Click random elements before clicking ads"><InfoOutlinedIcon fontSize="small"/></Tooltip>
                </Box>
              }
              sx={{ mb: 2 }}
            />
            {randomClicks && (
              <Box sx={{display: 'flex', gap: 2, mb: 2}}>
                <TextField
                  size="small"
                  type="number"
                  label="Min Clicks"
                  value={minRandomClicks}
                  onChange={(e) => setMinRandomClicks(Math.max(1, parseInt(e.target.value) || 1))}
                  InputProps={{ inputProps: { min: 1 } }}
                  sx={{ width: '50%' }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Max Clicks"
                  value={maxRandomClicks}
                  onChange={(e) => setMaxRandomClicks(Math.max(minRandomClicks, parseInt(e.target.value) || minRandomClicks))}
                  InputProps={{ inputProps: { min: minRandomClicks } }}
                  sx={{ width: '50%' }}
                />
              </Box>
            )}
            <Box sx={{display: 'flex', gap: 2}}>
              <TextField
                size="small"
                type="number"
                label="Min Scroll Duration"
                value={minScrollDuration}
                onChange={(e) => setMinScrollDuration(Math.max(1, parseInt(e.target.value) || 1))}
                InputProps={{ inputProps: { min: 1 } }}
                sx={{ width: '50%' }}
                helperText="seconds"
              />
              <TextField
                size="small"
                type="number"
                label="Max Scroll Duration"
                value={maxScrollDuration}
                onChange={(e) => setMaxScrollDuration(Math.max(minScrollDuration, parseInt(e.target.value) || minScrollDuration))}
                InputProps={{ inputProps: { min: minScrollDuration } }}
                sx={{ width: '50%' }}
                helperText="seconds"
              />
            </Box>
          </Paper>

          {/* Provider Settings */}
          <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 320 }}>
            <Box sx={{display:'flex', alignItems:'center', gap:1}}>
              <Typography variant="h6" gutterBottom>Provider Settings</Typography>
              <Tooltip title="Choose where to get proxies and fingerprints from."><InfoOutlinedIcon fontSize="small"/></Tooltip>
            </Box>
            <Box sx={{display: 'flex', flexDirection: 'column', gap: 2, flex: 1}}>
              <FormControl fullWidth size="small">
                <InputLabel sx={{display:'flex', alignItems:'center', gap:0.5}}>
                  Proxy Provider
                  <Tooltip title="Choose 'Default' for built-in proxy provider, or 'Custom' to use your own."><InfoOutlinedIcon fontSize="small"/></Tooltip>
                </InputLabel>
                <Select
                  value={proxyProvider}
                  onChange={(e) => setProxyProvider(e.target.value)}
                  label="Proxy Provider"
                >
                  <MenuItem value="default">Default</MenuItem>
                  <MenuItem value="custom">Custom</MenuItem>
                </Select>
              </FormControl>
              {proxyProvider === 'custom' && (
                <Tooltip title="Enter the URL of your custom proxy provider.">
                  <TextField
                    fullWidth
                    size="small"
                    label="Custom Proxy Provider URL"
                    value={customProxyProvider}
                    onChange={(e) => setCustomProxyProvider(e.target.value)}
                    placeholder="https://your-proxy-provider.com/api"
                  />
                </Tooltip>
              )}
              <FormControl fullWidth size="small">
                <InputLabel sx={{display:'flex', alignItems:'center', gap:0.5}}>
                  Fingerprint Provider
                  <Tooltip title="Choose 'Default' for built-in fingerprint provider, or 'Local' for local fingerprints, or 'Custom' to use your own."><InfoOutlinedIcon fontSize="small"/></Tooltip>
                </InputLabel>
                <Select
                  value={fingerprintProvider}
                  onChange={(e) => setFingerprintProvider(e.target.value)}
                  label="Fingerprint Provider"
                >
                  <MenuItem value="default">Default</MenuItem>
                  <MenuItem value="local">Local Fingerprints</MenuItem>
                  <MenuItem value="custom">Custom Provider</MenuItem>
                </Select>
              </FormControl>
              {fingerprintProvider === 'custom' && (
                <Tooltip title="Enter the URL of your custom fingerprint provider.">
                  <TextField
                    fullWidth
                    size="small"
                    label="Custom Fingerprint Provider URL"
                    value={customFingerprintProvider}
                    onChange={(e) => setCustomFingerprintProvider(e.target.value)}
                    placeholder="https://your-fingerprint-provider.com/api"
                  />
                </Tooltip>
              )}
              {fingerprintProvider === 'local' && (
                <Typography variant="caption" color="text.secondary">
                  Using fingerprints from public/fp directory
                </Typography>
              )}
            </Box>
          </Paper>
        </Box>

        {/* Ad Selector Management Section */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{display:'flex', alignItems:'center', gap:1}}>
            <Typography variant="h6" gutterBottom>Ad Selector Management</Typography>
            <Tooltip title="Add custom selectors to detect more ad types. Supports XPath, JavaScript, and CSS selectors."><InfoOutlinedIcon fontSize="small"/></Tooltip>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add custom selectors to help the automation detect and click more ad types. Supported formats:
            <Box component="ul" sx={{ mt: 1, pl: 2 }}>
              <li><code>CSS</code>: <code>a[href*='sponsor']</code>, <code>.ad-class</code>, <code>#ad-id</code></li>
              <li><code>XPath</code>: <code>//iframe[3]</code>, <code>/html/body/div[2]</code></li>
              <li><code>JavaScript</code>: <code>document.querySelector('.ad')</code>, <code>document.getElementById('ad')</code></li>
            </Box>
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Tooltip title="Enter a selector (CSS, XPath, or JavaScript) for ad elements, then click Add or press Enter.">
              <TextField
                size="small"
                label="New Ad Selector"
                value={newSelector}
                onChange={e => setNewSelector(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddSelector();
                }}
                fullWidth
                placeholder="Enter CSS, XPath, or JavaScript selector"
              />
            </Tooltip>
            <Tooltip title="Add this selector to the list.">
              <span>
                <Button
                  variant="contained"
                  onClick={handleAddSelector}
                  disabled={!newSelector.trim()}
                  sx={{ minWidth: 100 }}
                >
                  Add
                </Button>
              </span>
            </Tooltip>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {customSelectors.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                No custom selectors added yet.
              </Typography>
            ) : (
              customSelectors.map((selector, idx) => (
                <Tooltip key={selector+idx} title={`${detectSelectorType(selector).toUpperCase()} selector`}>
                  <Chip
                    label={selector}
                    onDelete={() => handleRemoveSelector(idx)}
                    color="primary"
                    variant="outlined"
                    sx={{ mb: 1 }}
                  />
                </Tooltip>
              ))
            )}
          </Box>
        </Paper>

        {/* Proxy Management Section */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Proxy Management</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Run automation without using any proxies.">
                <FormControlLabel
                  control={
                    <Switch
                      checked={noProxy}
                      onChange={(e) => {
                        setNoProxy(e.target.checked);
                        if (e.target.checked) {
                          setProxies([]);
                        }
                      }}
                    />
                  }
                  label="Run without proxy"
                />
              </Tooltip>
              <Tooltip title="Show or hide logs below.">
                <FormControlLabel
                  control={
                    <Switch
                      checked={showLogs}
                      onChange={(e) => setShowLogs(e.target.checked)}
                    />
                  }
                  label="Show Logs"
                />
              </Tooltip>
            </Box>
          </Box>

          {/* Proxy Input Methods */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 2, mb: 2 }}>
            {/* Upload Proxies */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>1. Upload Proxies File</Typography>
              <Button onClick={() => fileInput.current?.click()} variant="contained" size="small" fullWidth>
                Upload Proxies (.txt)
              </Button>
              <input hidden ref={fileInput} type="file" accept=".txt" onChange={handleFile}/>
            </Box>

            {/* Paste Proxies */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>2. Paste Proxies</Typography>
              <TextField 
                fullWidth
                label="Paste Proxies (one per line)" 
                multiline 
                minRows={2} 
                value={proxyInput}
                onChange={e=>setProxyInput(e.target.value)} 
                onBlur={e=>{addProxyLines(proxyInput); setProxyInput('');}} 
              />
            </Box>

            {/* Fetch Proxies */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>3. Fetch Free Proxies</Typography>
              <Box sx={{display: 'flex', flexDirection: 'column', gap: 1}}>
                {!fetchingProxies && !fetchError && (
                  <>
                    <Button 
                      onClick={() => handleFetchProxies(false)} 
                      color="secondary" 
                      variant="outlined" 
                      disabled={fetchingProxies}
                      fullWidth
                    >
                      Fetch Fresh Proxies
                    </Button>
                    <Button 
                      onClick={() => handleFetchProxies(true)} 
                      color="primary" 
                      variant="outlined" 
                      disabled={fetchingProxies || cacheStatus.totalCached === 0}
                      fullWidth
                    >
                      Use Last Fetched Proxies
                    </Button>
                  </>
                )}
              </Box>
            </Box>
          </Box>

          {/* Proxy Status and Management */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button onClick={handleClear} variant="outlined" color="error" size="small">
                Clear All Proxies
              </Button>
              <Typography variant="body2">
                Total Proxies: {proxies.length}
              </Typography>
            </Box>
            {cacheStatus.totalCached > 0 && (
              <Typography variant="body2" color="text.secondary">
                Cache Status: {cacheStatus.totalCached} proxies available (last updated: {cacheStatus.lastUpdated})
              </Typography>
            )}
          </Box>

          {/* Proxy Fetch Status */}
          {fetchingProxies && (
            <Typography color="info.main" sx={{mt:1}}>Fetching proxies, please wait...</Typography>
          )}
          {fetchError && (
            <Typography color="error" sx={{mt:1}}>
              {fetchError}
              <Button 
                onClick={() => handleFetchProxies(false)} 
                size="small" 
                sx={{ml:1}} 
                disabled={fetchingProxies}
              >
                Retry
              </Button>
            </Typography>
          )}
        </Paper>

        {/* Logs Section */}
        {showLogs && (
          <Paper sx={{p:2,mb:3}}>
            <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2}}>
              <Typography variant="h6">Activity Logs</Typography>
              <Button 
                size="small" 
                onClick={() => {
                  setProxyLogs([]);
                  setAutomationLogs([]);
                }}
              >
                Clear Logs
              </Button>
            </Box>

            {/* Automation Logs */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>Browser Automation</Typography>
              <Box 
                ref={automationLogRef}
                sx={{
                  height: 200,
                  overflowY: 'auto',
                  bgcolor: 'black',
                  p: 1,
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  color: '#00ff00'
                }}
              >
                {automationLogs.length === 0 ? (
                  <Typography color="#00ff00" sx={{fontStyle: 'italic'}}>
                    No automation activities logged yet
                  </Typography>
                ) : (
                  automationLogs.map((log, i) => (
                    <Typography key={i} component="div" sx={{whiteSpace: 'pre-wrap', color: '#00ff00'}}>
                      {log}
                    </Typography>
                  ))
                )}
              </Box>
            </Box>
          </Paper>
        )}

        {/* Results Section */}
        <Paper sx={{p:2}}>
          <Typography variant="h6" gutterBottom>Results</Typography>
          <Box sx={{ 
            minHeight: 160,
            maxHeight: 300,
            overflowY: 'auto',
            bgcolor: 'grey.50',
            p: 1,
            borderRadius: 1
          }}>
            {!Array.isArray(results) || results.length === 0 ? (
              <Typography>No results yet.</Typography>
            ) : (
              results.map((r,i) => (
                <Typography 
                  key={i} 
                  color={r.status==="OK"?'green':r.status==="BAD_IP"?'orange':'red'}
                  sx={{mb:0.5}}
                >
                  {r.proxy}: {r.status} {r.error?'- '+r.error:''}
                </Typography>
              ))
            )}
          </Box>
        </Paper>

        <Typography mt={4} color="gray" fontSize={14} sx={{textAlign: 'center'}}>
          Tool simulates browsers, rotates proxy/device fingerprint/user-agent, and attempts ad click.<br/>
          Use with caution. Logs and task runs local only.
        </Typography>

        {/* Close Confirmation Dialog */}
        <Dialog
          open={showCloseDialog}
          onClose={handleCloseCancel}
          aria-labelledby="close-dialog-title"
          disableEscapeKeyDown
          slotProps={{
            backdrop: {
              onClick: (e) => e.preventDefault()
            }
          }}
        >
          <DialogTitle id="close-dialog-title">Confirm Close</DialogTitle>
          <DialogContent>
            <Typography>Are you sure you want to close the application?</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseCancel} color="primary">
              Cancel
            </Button>
            <Button 
              onClick={handleCloseConfirm} 
              color="error" 
              variant="contained"
              autoFocus
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}

const rootDiv = document.getElementById('root');
if (!rootDiv) {
  const div = document.createElement('div');
  div.id = 'root';
  document.body.appendChild(div);
}
createRoot(document.getElementById('root')!).render(<App />);
