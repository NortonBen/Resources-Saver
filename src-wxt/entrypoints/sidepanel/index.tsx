import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
window.onerror = (msg, url, line) => {
  document.body.innerHTML = `<div style="padding: 20px; color: red;"><h1>Runtime Error</h1><p>${msg}</p><p>at ${url}:${line}</p></div>`;
  return false;
};
import { 
  Layout, 
  Typography, 
  Space, 
  Button, 
  Tabs, 
  Tag, 
  Input, 
  Switch, 
  QRCode,
  Divider,
  Badge,
  Table,
  Tooltip,
  Drawer,
  Empty,
  Progress,
  message,
  Tree,
  Modal,
  Form,
  ConfigProvider,
  App
} from 'antd';
import { 
  DownloadOutlined, 
  SettingOutlined, 
  ReloadOutlined,
  GlobalOutlined,
  FileZipOutlined,
  ThunderboltOutlined,
  ShareAltOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FilterOutlined,
  FileOutlined,
  LineChartOutlined,
  InfoCircleOutlined,
  ShareInternalOutlined,
  FolderOutlined
} from '@ant-design/icons';
import { resolveURLToPath, mimeTypeForDownload } from '../../lib/resource-utils';
import {
  loadResourceBytesForTab,
  uniquifyPath,
  downloadBlob,
  downloadUrl,
} from '../../lib/download-resource';
import { logger, LogLevel } from '../../lib/logger';
import JSZip from 'jszip';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import '../../assets/main.css';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

interface Resource {
  url: string;
  type: string;
  size: number;
  status: 'pending' | 'downloading' | 'success' | 'failed';
  origin: 'static' | 'network';
}

const SidePanel = () => {
  const [loading, setLoading] = useState(false);
  const [xhrEnabled, setXhrEnabled] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [resources, setResources] = useState<Resource[]>([]);
  const [searchText, setSearchText] = useState('');
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    autoOpenShelf: true,
    overwriteFiles: true,
    groupByType: false,
    debugMode: false
  });

  // Load settings on mount
  useEffect(() => {
    chrome.storage.local.get(['settings'], (result) => {
      if (result.settings) {
        setSettings(result.settings);
      }
    });
  }, []);

  const updateSettings = (newSettings: Partial<typeof settings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    chrome.storage.local.set({ settings: updated });
    
    // Apply debug mode to logger
    if (updated.debugMode) {
      logger.setLevel(LogLevel.DEBUG);
    } else {
      logger.setLevel(LogLevel.INFO);
    }
  };

  const updateTabInfo = useCallback(() => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.url) {
          setCurrentUrl(tabs[0].url);
          refreshResources(tabs[0].id);
        }
      });
    } catch (e) {
      console.error('Error updating tab info:', e);
    }
  }, []);

  const refreshResources = async (tabId?: number) => {
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) return;

    // Don't try to scrape restricted pages
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith('chrome://') || tab?.url?.startsWith('edge://') || tab?.url?.startsWith('about:')) {
      setResources([]);
      return;
    }

    setLoading(true);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const res: any[] = [];
          const collect = (url: string, type: string) => {
            if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('chrome-extension://')) {
              try {
                const absoluteUrl = new URL(url, document.baseURI).href;
                res.push({ url: absoluteUrl, type });
              } catch (e) {}
            }
          };

          // 1. DOM Elements
          document.querySelectorAll('img').forEach(img => collect(img.src, 'image'));
          document.querySelectorAll('script').forEach(s => s.src && collect(s.src, 'script'));
          document.querySelectorAll('link[rel="stylesheet"]').forEach(l => collect(l.href, 'stylesheet'));
          document.querySelectorAll('link[rel*="icon"]').forEach((l: any) => collect(l.href, 'image'));
          document.querySelectorAll('video, audio, source').forEach((m: any) => collect(m.src || m.srcset, 'media'));
          
          // 2. CSS Resources (Backgrounds, Fonts)
          try {
            for (const sheet of Array.from(document.styleSheets)) {
              try {
                for (const rule of Array.from(sheet.cssRules)) {
                  const cssText = rule.cssText;
                  const urls = cssText.match(/url\(['"]?([^'")]+)['"]?\)/g);
                  if (urls) {
                    urls.forEach(u => {
                      const rawUrl = u.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
                      if (rawUrl) {
                        if (rawUrl.match(/\.(woff2?|ttf|otf|eot)$/i)) collect(rawUrl, 'font');
                        else if (rawUrl.match(/\.(png|jpe?g|gif|svg|webp|avif)$/i)) collect(rawUrl, 'image');
                        else collect(rawUrl, 'asset');
                      }
                    });
                  }
                }
              } catch (e) {} // CORS might block reading some stylesheets
            }
          } catch (e) {}

          // 3. Inline Styles
          document.querySelectorAll('[style]').forEach((el: any) => {
            const bg = el.style.backgroundImage;
            if (bg && bg !== 'none') {
              const url = bg.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
              if (url) collect(url, 'image');
            }
          });

          // 4. Heuristic: Scan all attributes for file-like strings
          const fileRegex = /\.(png|jpe?g|gif|svg|webp|avif|js|css|woff2?|ttf|mp4|webm|mp3|pdf|zip|json|wasm)(\?.*)?$/i;
          document.querySelectorAll('*').forEach(el => {
            for (const attr of Array.from(el.attributes)) {
              if (attr.value.match(fileRegex)) {
                const type = attr.value.match(/\.(png|jpe?g|gif|svg|webp|avif)$/i) ? 'image' :
                             attr.value.match(/\.js$/i) ? 'script' :
                             attr.value.match(/\.css$/i) ? 'stylesheet' : 'file';
                collect(attr.value, type);
              }
            }
          });

          return res;
        }
      });

      if (results && results[0]?.result) {
        const discovered = results[0].result as { url: string; type: string }[];
        const unique = discovered.reduce((acc: Resource[], curr) => {
          if (!acc.find(r => r.url === curr.url)) {
            acc.push({
              url: curr.url,
              type: curr.type,
              size: 0,
              status: 'pending',
              origin: 'static'
            });
          }
          return acc;
        }, []);
        setResources(unique);
        message.success({ content: `Discovered ${unique.length} assets`, key: 'scrape', duration: 1 });
      }
    } catch (e) {
      console.warn('Scraping not allowed on this page or failed:', e);
      setResources([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    updateTabInfo();
    const tabListener = () => updateTabInfo();
    
    chrome.tabs.onActivated.addListener(tabListener);
    chrome.tabs.onUpdated.addListener((id, info) => {
      if (info.status === 'complete') updateTabInfo();
    });

    return () => {
      chrome.tabs.onActivated.removeListener(tabListener);
    };
  }, [updateTabInfo]);

  const filteredResources = React.useMemo(() => {
    return resources.filter(r => {
      const matchesSearch = !searchText || r.url.toLowerCase().includes(searchText.toLowerCase());
      const matchesTree = selectedTreeKeys.length === 0 || selectedTreeKeys.some(key => r.url.startsWith(key));
      
      if (!matchesSearch || !matchesTree) return false;
      if (r.url.startsWith('chrome-extension://')) return false;
      return true;
    });
  }, [resources, searchText, selectedTreeKeys]);

  // Build tree data whenever resources change
  const treeData = useMemo(() => {
    const root: any = {};
    resources.forEach(res => {
      try {
        const url = new URL(res.url);
        const parts = [url.origin, ...url.pathname.split('/').filter(p => p)];
        let current = root;
        parts.forEach((part, index) => {
          if (!current[part]) {
            current[part] = {
              title: part,
              key: parts.slice(0, index + 1).join('/'),
              children: {},
              isLeaf: index === parts.length - 1
            };
          }
          current = current[part].children;
        });
      } catch (e) {
        const part = res.url;
        if (!root[part]) root[part] = { title: part, key: part, children: {}, isLeaf: true };
      }
    });

    const convertToTree = (obj: any): any[] => {
      return Object.values(obj).map((node: any) => ({
        title: node.title,
        key: node.key,
        children: node.isLeaf ? undefined : convertToTree(node.children),
        isLeaf: node.isLeaf,
        selectable: true
      }));
    };
    return convertToTree(root);
  }, [resources]);

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    
    const filtered = filteredResources;
    if (filtered.length === 0) {
      message.warning('No resources found to download');
      setIsDownloading(false);
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    if (!tabId) {
      message.error('No active tab found');
      setIsDownloading(false);
      return;
    }

    message.info(`Downloading ${filtered.length} resources...`);

    const usedPaths = new Set<string>();
    let savedCount = 0;
    let failedCount = 0;
    let processed = 0;

    for (const res of filtered) {
      try {
        const resolved = resolveURLToPath(res.url, res.type);
        let finalPath = resolved.path;

        if (settings.groupByType) {
          const typeMap: Record<string, string> = {
            image: 'images',
            script: 'js',
            stylesheet: 'css',
            media: 'media',
            file: 'files',
          };
          const folder = typeMap[res.type] || 'others';
          finalPath = `${folder}/${resolved.path}`;
        }

        finalPath = uniquifyPath(finalPath, usedPaths);

        const bytes = await loadResourceBytesForTab(tabId, res.url);
        if (bytes) {
          await downloadBlob(
            new Blob([bytes.data], { type: mimeTypeForDownload(res.url, res.type) }),
            finalPath
          );
          savedCount++;
        } else {
          await downloadUrl(res.url, finalPath);
          savedCount++;
        }

        if (!settings.autoOpenShelf) {
          chrome.downloads.setShelfEnabled(false);
        }
      } catch (e) {
        console.error('Download failed for', res.url, e);
        failedCount++;
      }

      processed++;
      setDownloadProgress(Math.round((processed / filtered.length) * 100));
    }

    message.success(
      failedCount
        ? `Downloaded ${savedCount} files, ${failedCount} failed`
        : `Downloaded ${savedCount} files successfully`
    );
    setIsDownloading(false);
  };

  const columns = [
    {
      title: 'Resource',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => (
        <div className="flex flex-col">
          <Text strong className="text-[11px] truncate">{url.split('/').pop() || url}</Text>
          <Text type="secondary" className="text-[9px] truncate">{url}</Text>
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: (type: string) => <Tag color="blue" className="text-[9px] m-0 border-none bg-blue-50 text-blue-500 uppercase font-bold">{type}</Tag>,
    }
  ];

  const resourceStats = React.useMemo(() => {
    return {
      total: resources.length,
      images: resources.filter(r => r.type === 'image').length,
      scripts: resources.filter(r => r.type === 'script').length,
      styles: resources.filter(r => r.type === 'stylesheet').length,
      others: resources.filter(r => !['image', 'script', 'stylesheet'].includes(r.type)).length,
    };
  }, [resources]);

  const menuItems = [
    {
      key: 'main',
      label: <Space><ThunderboltOutlined /> Overview</Space>,
      children: (
        <div className="p-4 flex flex-col h-full animate-in fade-in duration-500 bg-slate-50/30">
           {/* Stat Cards */}
           <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider block mb-1 group-hover:text-blue-500 transition-colors">Total Assets</Text>
                <div className="flex items-end justify-between">
                  <Title level={2} className="m-0 leading-none text-slate-800">{resourceStats.total}</Title>
                  <div className="p-2 bg-blue-50 rounded-lg text-blue-500"><GlobalOutlined /></div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider block mb-1 group-hover:text-purple-500 transition-colors">Images</Text>
                <div className="flex items-end justify-between">
                  <Title level={2} className="m-0 leading-none text-slate-800">{resourceStats.images}</Title>
                  <div className="p-2 bg-purple-50 rounded-lg text-purple-500"><FileOutlined /></div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider block mb-1 group-hover:text-orange-500 transition-colors">Scripts</Text>
                <div className="flex items-end justify-between">
                  <Title level={2} className="m-0 leading-none text-slate-800">{resourceStats.scripts}</Title>
                  <div className="p-2 bg-orange-50 rounded-lg text-orange-500"><FileTextOutlined /></div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider block mb-1 group-hover:text-green-500 transition-colors">Styles</Text>
                <div className="flex items-end justify-between">
                  <Title level={2} className="m-0 leading-none text-slate-800">{resourceStats.styles}</Title>
                  <div className="p-2 bg-green-50 rounded-lg text-green-500"><FolderOpenOutlined /></div>
                </div>
              </div>
           </div>

           <div className="bg-white p-4 rounded-2xl mb-6 border border-slate-100 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <Text strong className="text-slate-700 text-xs">Target Website</Text>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <Text className="text-[10px] text-green-600 font-bold">LIVE</Text>
              </div>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-400">
                <GlobalOutlined />
              </div>
              <Text ellipsis type="secondary" className="text-[11px] font-medium block flex-1">{currentUrl || 'Waiting for navigation...'}</Text>
            </div>
          </div>

          <div className="space-y-3 mt-auto">
              <Button 
                type="primary" 
                icon={<DownloadOutlined />} 
                onClick={handleDownloadAll}
                loading={isDownloading}
                block
                className="rounded-xl h-14 font-bold bg-gradient-to-r from-blue-600 to-indigo-600 border-none shadow-xl shadow-blue-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Download All Resources
              </Button>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={() => refreshResources()}
                block
                className="rounded-xl h-12 font-medium border-slate-200 bg-white hover:border-blue-300 hover:text-blue-500 transition-all"
              >
                Refresh Scanner
              </Button>
            </div>
        </div>
      )
    },
    {
      key: 'resources',
      label: <Space><Badge count={filteredResources.length} size="small" offset={[10, -2]} color="#3b82f6"><LineChartOutlined /></Badge> Resources</Space>,
      children: (
        <div className="p-0 flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
          <div className="p-3 border-b border-slate-100 bg-slate-50/50">
            <Input 
              placeholder="Filter resources..." 
              prefix={<FilterOutlined className="text-slate-400" />} 
              size="small"
              className="rounded-lg border-slate-200"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
            />
          </div>
          <div className="flex-[0.6] overflow-auto p-2 border-b border-slate-100">
            <div className="px-2 mb-2">
              <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider">Source Tree</Text>
            </div>
            {treeData.length > 0 ? (
              <Tree
                showIcon
                blockNode
                autoExpandParent
                treeData={treeData}
                selectedKeys={selectedTreeKeys}
                onSelect={(keys: any) => setSelectedTreeKeys(keys)}
                icon={(nodeProps: any) => nodeProps.isLeaf ? <FileOutlined /> : <FolderOutlined />}
                className="bg-transparent text-slate-600 text-[11px] source-tree"
              />
            ) : (
              <Empty description="No resources" image={Empty.PRESENTED_IMAGE_SIMPLE} className="mt-4" />
            )}
          </div>
          <Divider className="m-0" />
          <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
            <Text type="secondary" className="text-[10px]">
              Showing <span className="font-bold text-blue-500">{filteredResources.length}</span> / {resources.length}
            </Text>
            <Button 
              size="small" 
              type="link" 
              className="text-[10px] p-0" 
              onClick={() => setSelectedTreeKeys([])}
              disabled={selectedTreeKeys.length === 0}
            >
              Clear filter
            </Button>
          </div>
          <div className="flex-[0.4] overflow-auto">
            <Table 
              dataSource={filteredResources} 
              columns={columns} 
              rowKey="url"
              size="small"
              loading={loading}
              pagination={false}
              className="resource-table-mini"
              onRow={(record) => ({
                onClick: () => setSelectedResource(record),
              })}
            />
          </div>
          {isDownloading && (
            <div className="p-3 bg-blue-50 border-t border-blue-100">
              <div className="flex justify-between text-[10px] mb-1">
                <Text strong>Downloading...</Text>
                <Text>{downloadProgress}%</Text>
              </div>
              <Progress percent={downloadProgress} size="small" showInfo={false} strokeColor="#3b82f6" />
            </div>
          )}
        </div>
      )
    }
  ];

  return (
    <Layout className="h-screen bg-white">
      <Header className="bg-white h-auto px-6 py-4 leading-none border-b border-slate-100">
        <div className="flex items-center justify-between">
          <Space size="middle">
            <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <DownloadOutlined style={{ color: 'white', fontSize: 24 }} />
            </div>
            <div>
              <Title level={4} className="m-0 text-slate-900 font-black tracking-tight">Resources Saver</Title>
              <div className="flex items-center gap-2 mt-1">
                <Text className="text-slate-400 text-[9px] uppercase font-bold tracking-widest flex items-center">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5" />
                  Sidepanel Edition
                </Text>
              </div>
            </div>
          </Space>
          <Button 
            type="text" 
            icon={<SettingOutlined style={{ color: '#94a3b8', fontSize: 20 }} />} 
            className="hover:bg-slate-100 rounded-2xl h-11 w-11 flex items-center justify-center transition-all"
            onClick={() => setIsSettingsOpen(true)}
          />
        </div>
      </Header>

      <Content className="flex flex-col bg-white overflow-hidden">
        <Tabs
          defaultActiveKey="main"
          className="side-panel-tabs flex-1"
          tabBarStyle={{ marginBottom: 0, borderBottom: '1px solid #f1f5f9', padding: '0 16px' }}
          items={menuItems}
        />
      </Content>

      <Footer className="py-4 px-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <Text className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">v0.0.1 stable</Text>
        <Space size="small">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          <Text className="text-[10px] text-slate-500 font-medium">System Ready</Text>
        </Space>
      </Footer>

      <Drawer
        title={<Text strong className="text-xs truncate block">{selectedResource?.url}</Text>}
        placement="bottom"
        height="40%"
        onClose={() => setSelectedResource(null)}
        open={!!selectedResource}
        styles={{ body: { padding: '12px' } }}
        extra={
          <Button 
            type="primary" 
            size="small" 
            icon={<DownloadOutlined />} 
            onClick={async () => {
              if (!selectedResource) return;
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (!tab?.id) return;
              const resolved = resolveURLToPath(selectedResource.url, selectedResource.type);
              const bytes = await loadResourceBytesForTab(tab.id, selectedResource.url);
              try {
                if (bytes) {
                  await downloadBlob(
                    new Blob([bytes.data], {
                      type: mimeTypeForDownload(selectedResource.url, selectedResource.type),
                    }),
                    resolved.path
                  );
                } else {
                  await downloadUrl(selectedResource.url, resolved.path);
                }
                message.success('Download started');
              } catch {
                message.error('Download failed');
              }
            }}
          >
            Download
          </Button>
        }
      >
        <div className="space-y-4">
          {selectedResource?.type === 'image' && (
            <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-center border border-slate-100 shadow-inner overflow-hidden">
              <img 
                src={selectedResource.url} 
                alt="Preview" 
                className="max-w-full max-h-[150px] rounded-lg shadow-sm bg-white"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://placehold.co/200x100?text=Preview+Error';
                }}
              />
            </div>
          )}
          {selectedResource?.type === 'media' && (
            <div className="bg-slate-50 p-4 rounded-xl flex flex-col items-center justify-center border border-slate-100 shadow-inner overflow-hidden">
              {selectedResource.url.match(/\.(mp4|webm|ogg)$/i) || selectedResource.url.includes('video') ? (
                <video 
                  src={selectedResource.url} 
                  controls 
                  className="max-w-full max-h-[200px] rounded-lg shadow-sm bg-black"
                />
              ) : (
                <audio 
                  src={selectedResource.url} 
                  controls 
                  className="w-full"
                />
              )}
              <div className="mt-2">
                <Text type="secondary" className="text-[10px] uppercase font-bold tracking-widest">Media Player</Text>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
              <Text type="secondary" className="text-[10px] block uppercase font-bold tracking-tight">Type</Text>
              <Tag color="blue" className="text-[10px] m-0 border-none bg-blue-100 text-blue-600 font-bold">{selectedResource?.type}</Tag>
            </div>
            <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
              <Text type="secondary" className="text-[10px] block uppercase font-bold tracking-tight">Origin</Text>
              <Text className="text-[10px] font-medium">{selectedResource?.origin}</Text>
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg break-all border border-slate-100">
            <Text type="secondary" className="text-[10px] block uppercase font-bold tracking-tight mb-1">Full URL</Text>
            <Text className="text-[9px] font-mono leading-tight text-slate-500">{selectedResource?.url}</Text>
          </div>
        </div>
      </Drawer>

      <Modal
        title={
          <Space>
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">
              <SettingOutlined />
            </div>
            <Text strong>Global Settings</Text>
          </Space>
        }
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsSettingsOpen(false)} className="rounded-lg px-6">
            Done
          </Button>
        ]}
        className="settings-modal"
        width={320}
        centered
      >
        <div className="py-4 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Text strong className="text-xs block">Download Shelf</Text>
              <Text type="secondary" className="text-[10px]">Show download progress bar at bottom</Text>
            </div>
            <Switch 
              size="small" 
              checked={settings.autoOpenShelf} 
              onChange={(checked) => updateSettings({ autoOpenShelf: checked })} 
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Text strong className="text-xs block">Overwrite Files</Text>
              <Text type="secondary" className="text-[10px]">Replace files if they already exist</Text>
            </div>
            <Switch 
              size="small" 
              checked={settings.overwriteFiles} 
              onChange={(checked) => updateSettings({ overwriteFiles: checked })} 
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Text strong className="text-xs block">Group by Type</Text>
              <Text type="secondary" className="text-[10px]">Add subfolders like /images, /scripts</Text>
            </div>
            <Switch 
              size="small" 
              checked={settings.groupByType} 
              onChange={(checked) => updateSettings({ groupByType: checked })} 
            />
          </div>

          <Divider className="my-2" />

          <div className="flex items-center justify-between">
            <div>
              <Text strong className="text-xs block">Debug Mode</Text>
              <Text type="secondary" className="text-[10px]">Enable detailed console logging</Text>
            </div>
            <Switch 
              size="small" 
              checked={settings.debugMode} 
              onChange={(checked) => updateSettings({ debugMode: checked })} 
            />
          </div>
          
          <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 mt-4">
            <Space align="start">
              <InfoCircleOutlined className="text-blue-500 mt-0.5" />
              <Text className="text-[10px] text-blue-700 leading-tight block">
                Settings are synced across your devices and applied immediately to the current session.
              </Text>
            </Space>
          </div>
        </div>
      </Modal>

      <style>{`
        .side-panel-tabs .ant-tabs-nav::before { border-bottom: none; }
        .side-panel-tabs .ant-tabs-tab { padding: 16px 12px; margin: 0 !important; font-weight: 700; color: #94a3b8; transition: all 0.3s; }
        .side-panel-tabs .ant-tabs-tab-active { color: #2563eb !important; }
        .side-panel-tabs .ant-tabs-ink-bar { height: 3px !important; border-radius: 3px 3px 0 0; background: #2563eb !important; }
        .side-panel-tabs .ant-tabs-content-holder { display: flex; flex-direction: column; overflow: hidden; }
        .side-panel-tabs .ant-tabs-content { height: 100%; }
        .side-panel-tabs .ant-tabs-tabpane { height: 100%; overflow: auto; }
        .resource-table-mini .ant-table-thead > tr > th { font-size: 10px; padding: 12px 8px; background: #f8fafc; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; border-bottom: 1px solid #f1f5f9; }
        .resource-table-mini .ant-table-tbody > tr > td { padding: 10px 8px; cursor: pointer; border-bottom: 1px solid #f8fafc; }
        .resource-table-mini .ant-table-tbody > tr:hover > td { background: #eff6ff !important; }
        .source-tree .ant-tree-node-content-wrapper { padding: 4px 8px !important; border-radius: 8px !important; transition: all 0.2s; }
        .source-tree .ant-tree-node-selected { background: #eff6ff !important; color: #2563eb !important; font-weight: 600; }
        .source-tree .ant-tree-switcher { display: flex; align-items: center; justify-content: center; }
      `}</style>
    </Layout>
  );
};

const SidePanelWrapper = () => (
  <ConfigProvider theme={{ token: { borderRadius: 16, colorPrimary: '#2563eb' } }}>
    <App>
      <SidePanel />
    </App>
  </ConfigProvider>
);

const rootElement = document.getElementById('root') || (() => {
  const el = document.createElement('div');
  el.id = 'root';
  document.body.appendChild(el);
  return el;
})();

const rootKey = '__RESOURCES_SAVER_SIDEPANEL_ROOT__';
let root = (window as any)[rootKey];

if (!root && rootElement) {
  root = ReactDOM.createRoot(rootElement);
  (window as any)[rootKey] = root;
}

if (root) {
  root.render(
    <SidePanelWrapper />
  );
}
