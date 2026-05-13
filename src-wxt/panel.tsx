import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Layout, 
  Table, 
  Button, 
  Space, 
  Typography, 
  Tag, 
  Badge, 
  Card, 
  Input, 
  Switch, 
  Tooltip, 
  Progress,
  message,
  Divider,
  List,
  Drawer,
  Empty,
  Tree,
  ConfigProvider,
  App
} from 'antd';
import { 
  DownloadOutlined, 
  ReloadOutlined, 
  DeleteOutlined, 
  FilterOutlined,
  FileZipOutlined,
  GlobalOutlined,
  FileOutlined,
  ThunderboltOutlined,
  LinkOutlined,
  MenuOutlined,
  SettingOutlined,
  FolderOutlined,
  FolderOpenOutlined
} from '@ant-design/icons';
import { logger } from './lib/logger';
import { resolveURLToPath, cleanUrlForComparison } from './lib/resource-utils';
import JSZip from 'jszip';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import './assets/main.css';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

interface Resource {
  url: string;
  type: string;
  size: number;
  status: 'pending' | 'downloading' | 'success' | 'failed';
  origin: 'static' | 'network';
}

// Store non-serializable getContent functions outside of React state
const contentHandlers = new Map<string, (cb: (content: string, encoding: string) => void) => void>();

const DevToolsPanel = () => {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [xhrEnabled, setXhrEnabled] = useState(true);
  const [allDomainEnabled, setAllDomainEnabled] = useState(false);
  const [zipEnabled, setZipEnabled] = useState(true);
  const [beautifyEnabled, setBeautifyEnabled] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewEncoding, setPreviewEncoding] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>([]);
  const [currentDomain, setCurrentDomain] = useState<string>('');

  // Collect resources
  const refreshResources = useCallback(() => {
    setLoading(true);
    const foundResources: Resource[] = [];
    
    // 1. Get Static Resources
    chrome.devtools.inspectedWindow.getResources((res) => {
      res.forEach(r => {
        if (r.url.startsWith('chrome-extension://')) return;
        contentHandlers.set(r.url, r.getContent.bind(r));
        foundResources.push({
          url: r.url,
          type: r.type || 'unknown',
          size: 0,
          status: 'pending',
          origin: 'static',
        });
      });
      
      // 2. Get XHR if enabled (this requires HAR)
      if (xhrEnabled) {
        chrome.devtools.network.getHAR((har) => {
          har.entries.forEach(entry => {
            const url = entry.request.url;
            if (url.startsWith('chrome-extension://')) return;
            if (!foundResources.find(r => r.url === url)) {
              contentHandlers.set(url, entry.getContent.bind(entry));
              foundResources.push({
                url,
                type: entry.response.content.mimeType || 'xhr',
                size: entry.response.content.size || 0,
                status: 'pending',
                origin: 'network',
              });
            }
          });
          setResources(foundResources);
          setLoading(false);
        });
      } else {
        setResources(foundResources);
        setLoading(false);
      }
    });
  }, [xhrEnabled]);

  useEffect(() => {
    refreshResources();
    
    // Listen for new resources
    const onResourceAdded = (resource: any) => {
      if (resource.url.startsWith('chrome-extension://')) return;
      setResources(prev => {
        if (prev.find(r => r.url === resource.url)) return prev;
        contentHandlers.set(resource.url, resource.getContent.bind(resource));
        return [...prev, {
          url: resource.url,
          type: resource.type || 'unknown',
          size: 0,
          status: 'pending',
          origin: 'static',
        }];
      });
    };

    chrome.devtools.inspectedWindow.onResourceAdded.addListener(onResourceAdded);
    
    // Get current domain
    chrome.tabs.get(chrome.devtools.inspectedWindow.tabId, (tab) => {
      if (tab?.url) {
        setCurrentDomain(new URL(tab.url).hostname);
      }
    });

    return () => {
      chrome.devtools.inspectedWindow.onResourceAdded.removeListener(onResourceAdded);
    };
  }, [refreshResources]);

  // Memoize tree data to avoid expensive recalculations and potential cloning issues
  const treeData = useMemo(() => {
    const root: any = {};
    
    resources.forEach(res => {
      try {
        const url = new URL(res.url);
        const path = url.pathname === '/' ? 'index.html' : url.pathname;
        const parts = [url.hostname, ...path.split('/').filter(Boolean)];
        
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
        // Fallback for invalid URLs
        if (!root['other']) {
          root['other'] = { title: 'other', key: 'other', children: {}, isLeaf: false };
        }
        const safeKey = res.url.replace(/[^a-zA-Z0-9]/g, '_');
        root['other'].children[safeKey] = {
          title: res.url.split('/').pop() || res.url,
          key: res.url,
          children: {},
          isLeaf: true
        };
      }
    });

    const convertToTree = (obj: any): any[] => {
      return Object.values(obj).map((node: any) => ({
        title: node.title,
        key: node.key,
        children: node.isLeaf ? undefined : convertToTree(node.children),
        isLeaf: node.isLeaf, // Keep metadata for the icon renderer
        selectable: true
      }));
    };

    return convertToTree(root);
  }, [resources]);

  const filteredResources = React.useMemo(() => {
    return resources.filter(r => {
      const matchesSearch = !searchText || r.url.toLowerCase().includes(searchText.toLowerCase());
      const matchesTree = selectedTreeKeys.length === 0 || selectedTreeKeys.some(key => r.url.startsWith(key));
      const matchesDomain = allDomainEnabled || !currentDomain || r.url.includes(currentDomain);
      
      if (!matchesSearch || !matchesTree || !matchesDomain) return false;
      if (r.url.startsWith('chrome-extension://')) return false;
      
      return true;
    });
  }, [resources, searchText, selectedTreeKeys, allDomainEnabled, currentDomain]);

  const handleRowClick = (record: Resource) => {
    setSelectedResource(record);
    setPreviewLoading(true);
    setPreviewContent('');
    
    const handler = contentHandlers.get(record.url);
    if (!handler) {
      setPreviewLoading(false);
      message.error('Could not get content handler for this resource');
      return;
    }

    handler(async (content, encoding) => {
      let finalContent = content;
      let finalEncoding = encoding;

      // Fallback for manifest/json if getContent is empty
      if (!finalContent && (record.url.endsWith('.webmanifest') || record.url.endsWith('.json') || record.type === 'manifest')) {
        try {
          const response = await fetch(record.url);
          finalContent = await response.text();
          finalEncoding = 'text';
        } catch (e) {
          logger.error('Failed to fetch manifest content manually', e);
        }
      }

      setPreviewContent(finalContent || '');
      setPreviewEncoding(finalEncoding || '');
      setPreviewLoading(false);
    });
  };

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    
    const filtered = filteredResources;

    if (filtered.length === 0) {
      message.warning('No resources found to download');
      setIsDownloading(false);
      return;
    }

    message.info(`Starting download of ${filtered.length} files...`);

    // Download logic
    let completedCount = 0;
    const zip = zipEnabled ? new JSZip() : null;

    for (const res of filtered) {
      try {
        const resolved = resolveURLToPath(res.url, res.type);
        
        const handler = contentHandlers.get(res.url);
        if (!handler) {
          completedCount++;
          continue;
        }

        await new Promise<void>((resolve) => {
          handler((content, encoding) => {
            if (content) {
              const data = encoding === 'base64' ? atob(content) : content;
              if (zip) {
                zip.file(resolved.path, data, { binary: encoding === 'base64' });
              } else {
                const blob = new Blob([data], { type: res.type });
                const url = URL.createObjectURL(blob);
                chrome.downloads.download({
                  url: url,
                  filename: resolved.path,
                  conflictAction: 'overwrite',
                  saveAs: false
                }, () => {
                  URL.revokeObjectURL(url);
                });
              }
            } else if (!zip) {
              // Fallback to direct URL download if content not available and not zipping
              chrome.downloads.download({
                url: res.url,
                filename: resolved.path,
                conflictAction: 'overwrite',
                saveAs: false
              });
            }
            resolve();
          });
        });

        completedCount++;
        setDownloadProgress(Math.round((completedCount / filtered.length) * 100));
      } catch (error) {
        logger.error(`Failed to process ${res.url}`, error);
      }
    }

    if (zip) {
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      chrome.downloads.download({
        url: url,
        filename: `${currentDomain || 'resources'}.zip`,
        conflictAction: 'overwrite',
        saveAs: false
      }, () => URL.revokeObjectURL(url));
    }

    message.success(zip ? 'ZIP archive created!' : `Successfully downloaded ${completedCount} files!`);
    setIsDownloading(false);
  };

  const columns = [
    {
      title: 'Resource',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => {
        const fileName = url.split('/').pop() || url;
        return (
          <Space direction="vertical" size={0}>
            <Text strong className="text-xs md:text-sm truncate max-w-[150px] md:max-w-none">
              {fileName}
            </Text>
            <Text type="secondary" className="text-[10px] md:text-xs truncate max-w-[150px] md:max-w-none">
              {url}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (type: string) => <Tag color="blue" className="text-[10px] md:text-xs m-0">{type}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      responsive: ['md'],
      render: (status: string) => (
        <Badge status={status === 'success' ? 'success' : 'default'} text={status} />
      ),
    },
  ];

  return (
    <Layout className="h-screen bg-white responsive-layout">
      <Sider 
        width={280} 
        theme="light" 
        className="border-r border-slate-200 p-4 main-sider"
        collapsible
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        breakpoint="lg"
        collapsedWidth={0}
        trigger={null}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Title level={5} className="mb-4">Configuration</Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div className="flex justify-between items-center">
                <Text>Collect XHR</Text>
                <Switch checked={xhrEnabled} onChange={setXhrEnabled} size="small" />
              </div>
              <div className="flex justify-between items-center">
                <Text>All Domains</Text>
                <Switch checked={allDomainEnabled} onChange={setAllDomainEnabled} size="small" />
              </div>
              <div className="flex justify-between items-center">
                <Text>Save as ZIP</Text>
                <Switch checked={zipEnabled} onChange={setZipEnabled} size="small" />
              </div>
              <div className="flex justify-between items-center">
                <Text>Beautify Code</Text>
                <Switch checked={beautifyEnabled} onChange={setBeautifyEnabled} size="small" />
              </div>
            </Space>
          </div>

          <Divider />

          <div className="flex-grow overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <Title level={5} style={{ margin: 0 }}>Source Map</Title>
              <Tooltip title="Clear selection">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<ReloadOutlined style={{ fontSize: '12px' }} />} 
                  onClick={() => setSelectedTreeKeys([])}
                  disabled={selectedTreeKeys.length === 0}
                />
              </Tooltip>
            </div>
            <div className="overflow-auto flex-grow custom-scrollbar pr-2">
              {treeData.length > 0 ? (
                <Tree
                  showIcon
                  blockNode
                  treeData={treeData}
                  selectedKeys={selectedTreeKeys}
                  onSelect={(keys: any) => setSelectedTreeKeys(keys)}
                  icon={(nodeProps: any) => nodeProps.isLeaf ? <FileOutlined /> : <FolderOutlined />}
                  className="bg-transparent text-slate-600 text-xs"
                />
              ) : (
                <div className="py-8 text-center bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                  <Text type="secondary" className="text-xs">No resources to map</Text>
                </div>
              )}
            </div>
          </div>

          <Divider />


          {isDownloading && (
            <div className="mt-4">
              <Text type="secondary">Progress</Text>
              <Progress percent={downloadProgress} status="active" />
            </div>
          )}
        </Space>
      </Sider>

      <Content className="p-0 overflow-auto bg-slate-50/30 relative">
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-100 p-3 mb-4 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="flex items-center gap-2">
              <Button 
                type="text" 
                icon={<SettingOutlined />} 
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="lg:hidden flex items-center justify-center text-slate-500"
              />
              <Title level={4} style={{ margin: 0 }} className="text-slate-800 whitespace-nowrap">Resources</Title>
              <Badge 
                count={resources.length} 
                overflowCount={999} 
                style={{ backgroundColor: '#e6f4ff', color: '#1677ff', boxShadow: 'none', fontWeight: 600 }}
              />
              <Divider type="vertical" className="mx-1" />
              <div className="hidden sm:flex items-center gap-2">
                <Text type="secondary" className="text-[10px] uppercase tracking-wider font-semibold">
                  Requests: <span className="text-slate-600">{resources.filter(r => r.origin === 'network').length}</span>
                </Text>
                <Text type="secondary" className="text-[10px] uppercase tracking-wider font-semibold">
                  Static: <span className="text-slate-600">{resources.filter(r => r.origin === 'static').length}</span>
                </Text>
              </div>
            </div>
            
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Input 
                placeholder="Search..." 
                prefix={<FilterOutlined className="text-slate-400" />} 
                className="flex-grow md:w-[200px] lg:w-[300px] rounded-lg border-slate-200"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                allowClear
              />
              <Space size={4}>
                <Tooltip title="Refresh List">
                  <Button 
                    icon={<ReloadOutlined />} 
                    onClick={refreshResources}
                    disabled={isDownloading}
                    className="flex items-center justify-center"
                  />
                </Tooltip>
                <Button 
                  type="primary" 
                  icon={<DownloadOutlined />} 
                  loading={isDownloading}
                  onClick={handleDownloadAll}
                  className="bg-blue-600 shadow-sm flex items-center px-4"
                >
                  <span className="hidden sm:inline ml-1">Download All</span>
                </Button>
              </Space>
            </div>
          </div>
        </div>
        
        <div className="p-4">

        <Table 
          dataSource={filteredResources} 
          columns={columns} 
          rowKey="url"
          loading={loading}
          pagination={{ pageSize: 50, showSizeChanger: true }}
          size="middle"
          className="border border-slate-100 rounded-lg overflow-hidden cursor-pointer"
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
          })}
        />
        </div>

        <Drawer
          title={
            <Space>
              <FileOutlined />
              <Text strong ellipsis style={{ maxWidth: 400 }}>{selectedResource?.url}</Text>
            </Space>
          }
          placement="right"
          onClose={() => setSelectedResource(null)}
          open={!!selectedResource}
          width={window.innerWidth < 640 ? '100%' : '75%'}
          styles={{ body: { padding: 0 } }}
          extra={
            <Space>
              <Tag color="blue">{selectedResource?.type}</Tag>
              <Button 
                icon={<DownloadOutlined />} 
                onClick={() => {
                  if (selectedResource) {
                    const resolved = resolveURLToPath(selectedResource.url, selectedResource.type);
                    const handler = contentHandlers.get(selectedResource.url);
                    if (handler) {
                      handler((content, encoding) => {
                        const data = encoding === 'base64' ? atob(content) : content;
                        const blob = new Blob([data], { type: selectedResource.type });
                        const url = URL.createObjectURL(blob);
                        chrome.downloads.download({ url, filename: resolved.path });
                      });
                    } else {
                      // Fallback to direct URL if handler missing
                      chrome.downloads.download({ url: selectedResource.url, filename: resolved.path });
                    }
                  }
                }}
              >
                Download
              </Button>
            </Space>
          }
        >
          {previewLoading ? (
            <div className="flex justify-center items-center h-full">
              <Progress type="circle" percent={100} status="active" />
            </div>
          ) : previewContent ? (
            <div className="flex flex-col h-full bg-slate-50">
              {/* Toolbar */}
              <div className="bg-white border-b border-slate-200 px-4 py-2 flex justify-between items-center shadow-sm z-10">
                <Space>
                  <Tag color="blue" className="m-0 uppercase font-bold text-[10px]">{selectedResource?.type}</Tag>
                  <Text type="secondary" className="text-[10px] font-medium">
                    {previewEncoding === 'base64' ? 'BASE64' : 'TEXT'} • {previewContent.length.toLocaleString()} chars
                  </Text>
                </Space>
                <Space>
                  {!selectedResource?.type.includes('image') && !selectedResource?.type.includes('video') && !selectedResource?.type.includes('audio') && (
                    <Button 
                      size="small" 
                      icon={<ThunderboltOutlined />} 
                      onClick={() => {
                        navigator.clipboard.writeText(previewContent);
                        message.success('Copied to clipboard');
                      }}
                    >
                      Copy Content
                    </Button>
                  )}
                  <Button 
                    size="small" 
                    type="primary"
                    icon={<DownloadOutlined />} 
                    onClick={() => {
                      if (selectedResource) {
                        const resolved = resolveURLToPath(selectedResource.url, selectedResource.type);
                        const data = previewEncoding === 'base64' ? atob(previewContent) : previewContent;
                        const blob = new Blob([data], { type: selectedResource.type });
                        const url = URL.createObjectURL(blob);
                        chrome.downloads.download({ url, filename: resolved.path });
                      }
                    }}
                  >
                    Download
                  </Button>
                </Space>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-auto p-4 flex items-start justify-center custom-scrollbar">
                {selectedResource?.type.includes('image') ? (
                  <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200 max-w-full animate-in zoom-in-95 duration-300">
                    <img 
                      src={previewEncoding === 'base64' ? `data:${selectedResource.type};base64,${previewContent}` : previewContent} 
                      alt="Preview" 
                      className="max-w-full max-h-[70vh] h-auto rounded-xl shadow-inner cursor-zoom-in"
                    />
                    <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                      <Text strong className="text-slate-800 block">Image Preview</Text>
                      <Text type="secondary" className="text-[11px]">{selectedResource?.url.split('/').pop()}</Text>
                    </div>
                  </div>
                ) : selectedResource?.type.includes('video') || selectedResource?.type.includes('media') ? (
                  <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200 w-full max-w-4xl animate-in zoom-in-95 duration-300">
                    <video 
                      src={selectedResource.url} 
                      controls 
                      className="w-full h-auto rounded-xl shadow-2xl bg-black aspect-video"
                    />
                    <div className="mt-4 text-center">
                      <Text strong className="text-slate-800">Media Content</Text>
                    </div>
                  </div>
                ) : selectedResource?.type.includes('audio') ? (
                  <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200 w-full max-w-md animate-in slide-in-from-bottom-4 duration-300">
                     <audio 
                      src={selectedResource.url} 
                      controls 
                      className="w-full"
                    />
                    <div className="mt-4 text-center">
                      <Text strong className="text-slate-800">Audio Stream</Text>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col">
                    <div className="bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex-1 flex flex-col border border-slate-800">
                      <div className="bg-slate-800/50 px-4 py-2 flex items-center justify-between border-b border-slate-700/50">
                        <Space size="small">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                          <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                          <Text className="text-slate-400 text-[10px] ml-2 font-mono">{selectedResource?.url.split('/').pop()}</Text>
                        </Space>
                      </div>
                      <pre className="m-0 p-6 flex-1 overflow-auto text-[13px] font-mono custom-scrollbar leading-relaxed">
                        <code 
                          className="text-slate-200 block"
                          dangerouslySetInnerHTML={{ 
                            __html: hljs.highlightAuto(previewContent.substring(0, 50000)).value 
                          }} 
                        />
                        {previewContent.length > 50000 && (
                          <div className="mt-8 p-4 bg-slate-800/80 rounded-xl text-center text-slate-400 italic border border-slate-700">
                            Content truncated for performance (Showing 50,000 / {previewContent.length.toLocaleString()} characters)
                          </div>
                        )}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Empty description="No content found for this resource" />
          )}
        </Drawer>
      </Content>
    </Layout>
  );
};

const AppWrapper = () => (
  <ConfigProvider theme={{ token: { borderRadius: 12, colorPrimary: '#2563eb' } }}>
    <App>
      <DevToolsPanel />
    </App>
  </ConfigProvider>
);

const rootElement = document.getElementById('root') || (() => {
  const el = document.createElement('div');
  el.id = 'root';
  document.body.appendChild(el);
  return el;
})();

const rootKey = '__RESOURCES_SAVER_ROOT__';
let root = (window as any)[rootKey];

if (!root) {
  root = ReactDOM.createRoot(rootElement);
  (window as any)[rootKey] = root;
}

root.render(
  <AppWrapper />
);
