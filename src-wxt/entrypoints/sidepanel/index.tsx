import React, { useState, useMemo } from 'react';
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
  Divider,
  Table,
  Drawer,
  Empty,
  Progress,
  message,
  Tree,
  Modal,
  Select,
  ConfigProvider,
  App,
} from 'antd';
import {
  DownloadOutlined,
  ReloadOutlined,
  GlobalOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FilterOutlined,
  FileOutlined,
  InfoCircleOutlined,
  FolderOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { LayoutDashboard, Files, Settings, Layers, Radio, ImageIcon, FileCode2 } from 'lucide-react';

const EXT_ICON_URL = chrome.runtime.getURL('icons/icon48.png');
import { resolveURLToPath, mimeTypeForDownload } from '../../lib/resource-utils';
import {
  loadResourceBytesForTab,
  uniquifyPath,
  downloadBlob,
  downloadUrl,
  base64ToUint8Array,
} from '../../lib/download-resource';
import { logger, LogLevel } from '../../lib/logger';
import { useCaptureSession } from '../../lib/use-capture-session';
import type { CaptureTaskKind, CapturedResource } from '../../lib/capture-messages';
import { isRestrictedTabUrl } from '../../lib/capture-messages';
import JSZip from 'jszip';
import '../../assets/main.css';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

function TabNavLabel({
  icon: Icon,
  children,
  count,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <span className="sidepanel-tab-label inline-flex items-center gap-1.5 max-w-full">
      <Icon size={15} strokeWidth={2.25} className="shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
      {count != null && count > 0 && (
        <span className="sidepanel-tab-badge shrink-0" aria-label={`${count} items`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  );
}

const TASK_OPTIONS: { value: CaptureTaskKind; label: string; description: string }[] = [
  {
    value: 'dom-scan',
    label: 'DOM scan',
    description: 'Collect images, scripts, and CSS from the page (one-time)',
  },
  {
    value: 'network-live',
    label: 'Network monitor',
    description: 'Record requests as the page loads more assets',
  },
];

const SidePanel = () => {
  const {
    activeTab,
    session,
    loading,
    targetTabId,
    targetUrl,
    targetTitle,
    isMonitoring,
    resources,
    startTask,
    stopTask,
    runDomScan,
    syncFromBackground,
    useCurrentTabAsTarget,
  } = useCaptureSession();

  const [selectedTask, setSelectedTask] = useState<CaptureTaskKind>('network-live');
  const [searchText, setSearchText] = useState('');
  const [selectedResource, setSelectedResource] = useState<CapturedResource | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [selectedTreeKeys, setSelectedTreeKeys] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    autoOpenShelf: true,
    overwriteFiles: true,
    debugMode: false,
    zipEnabled: true,
  });

  React.useEffect(() => {
    chrome.storage.local.get(['settings'], (result) => {
      if (result.settings) {
        setSettings((prev) => ({ ...prev, ...result.settings }));
      }
    });
  }, []);

  const updateSettings = (newSettings: Partial<typeof settings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    chrome.storage.local.set({ settings: updated });
    logger.setLevel(updated.debugMode ? LogLevel.DEBUG : LogLevel.INFO);
  };

  const targetRestricted = isRestrictedTabUrl(targetUrl);
  const targetHost = useMemo(() => {
    try {
      return targetUrl ? new URL(targetUrl).hostname : '';
    } catch {
      return '';
    }
  }, [targetUrl]);

  const handleStartTask = async () => {
    if (!targetTabId || targetRestricted) {
      message.warning('Open a valid http(s) page tab to monitor');
      return;
    }
    try {
      const next = await startTask(selectedTask, targetTabId);
      if (selectedTask === 'dom-scan') {
        message.success(`Scanned ${next.resources.length} resources from the DOM`);
      } else {
        message.success('Monitoring network requests for this tab');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not start task');
    }
  };

  const handleStopTask = async () => {
    await stopTask();
    message.info('Stopped network monitoring');
  };

  const handleRefreshDom = async () => {
    if (!targetTabId || targetRestricted) return;
    try {
      const count = await runDomScan(targetTabId);
      message.success({ content: `DOM updated: +${count} items`, key: 'scrape', duration: 1.5 });
    } catch {
      message.error('Could not scan this page');
    }
  };

  const handlePinCurrentTab = async () => {
    try {
      await useCurrentTabAsTarget();
      message.success('Target website set to the current tab');
    } catch (e) {
      message.warning(e instanceof Error ? e.message : 'Current tab cannot be monitored');
    }
  };

  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      const matchesSearch =
        !searchText || r.url.toLowerCase().includes(searchText.toLowerCase());
      const matchesTree =
        selectedTreeKeys.length === 0 ||
        selectedTreeKeys.some((key) => r.url.startsWith(key));
      if (!matchesSearch || !matchesTree) return false;
      return !r.url.startsWith('chrome-extension://');
    });
  }, [resources, searchText, selectedTreeKeys]);

  const treeData = useMemo(() => {
    const root: Record<string, unknown> = {};
    resources.forEach((res) => {
      try {
        const url = new URL(res.url);
        const parts = [url.origin, ...url.pathname.split('/').filter((p) => p)];
        let current = root;
        parts.forEach((part, index) => {
          const node = current[part] as {
            title: string;
            key: string;
            children: Record<string, unknown>;
            isLeaf: boolean;
          } | undefined;
          if (!node) {
            current[part] = {
              title: part,
              key: parts.slice(0, index + 1).join('/'),
              children: {},
              isLeaf: index === parts.length - 1,
            };
          }
          current = (current[part] as { children: Record<string, unknown> }).children;
        });
      } catch {
        const part = res.url;
        if (!root[part]) {
          root[part] = { title: part, key: part, children: {}, isLeaf: true };
        }
      }
    });

    const convertToTree = (obj: Record<string, unknown>): object[] =>
      Object.values(obj).map((node: { title: string; key: string; children: Record<string, unknown>; isLeaf: boolean }) => ({
        title: node.title,
        key: node.key,
        children: node.isLeaf ? undefined : convertToTree(node.children),
        isLeaf: node.isLeaf,
        selectable: true,
      }));

    return convertToTree(root);
  }, [resources]);

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);

    const filtered = filteredResources;
    if (filtered.length === 0) {
      message.warning('No resources to download');
      setIsDownloading(false);
      return;
    }
    if (!targetTabId) {
      message.error('No target tab selected');
      setIsDownloading(false);
      return;
    }

    message.info(`Downloading ${filtered.length} files...`);

    const zip = settings.zipEnabled ? new JSZip() : null;
    const usedPaths = new Set<string>();
    let savedCount = 0;
    let failedCount = 0;
    let processed = 0;

    for (const res of filtered) {
      try {
        const resolved = resolveURLToPath(res.url, res.type);
        let finalPath = resolved.path;



        finalPath = uniquifyPath(finalPath, usedPaths);

        let bytes: { data: Uint8Array } | null = null;
        if (res.url.startsWith('data:')) {
          try {
            const commaIndex = res.url.indexOf(',');
            if (commaIndex !== -1) {
              const dataPart = res.url.substring(commaIndex + 1);
              const isBase64 = res.url.substring(0, commaIndex).includes('base64');
              const array = isBase64 
                ? base64ToUint8Array(dataPart)
                : new TextEncoder().encode(decodeURIComponent(dataPart));
              bytes = { data: array };
            }
          } catch (e) {
            console.error('Failed to parse data URI', e);
          }
        } else {
          bytes = await loadResourceBytesForTab(targetTabId, res.url);
        }

        if (bytes) {
          if (zip) {
            zip.file(finalPath, bytes.data);
          } else {
            await downloadBlob(
              new Blob([bytes.data], { type: mimeTypeForDownload(res.url, res.type) }),
              finalPath
            );
          }
          savedCount++;
        } else {
          if (zip) {
            failedCount++;
          } else {
            await downloadUrl(res.url, finalPath);
            savedCount++;
          }
        }

        if (!zip && !settings.autoOpenShelf) {
          chrome.downloads.setShelfEnabled(false);
        }
      } catch (e) {
        console.error('Download failed for', res.url, e);
        failedCount++;
      }

      processed++;
      setDownloadProgress(Math.round((processed / filtered.length) * 100));
    }

    if (zip) {
      if (savedCount === 0) {
        message.error('No files could be saved into the ZIP archive');
      } else {
        try {
          message.info('Generating ZIP archive...');
          const zipContent = await zip.generateAsync({ type: 'blob' });
          await downloadBlob(zipContent, `${targetHost || 'resources'}.zip`);
          message.success(
            failedCount
              ? `Successfully created ZIP with ${savedCount} files (${failedCount} failed/skipped)`
              : `Successfully created ZIP with ${savedCount} files`
          );
        } catch (e) {
          console.error('Failed to generate ZIP archive', e);
          message.error('Failed to generate ZIP archive');
        }
      }
    } else {
      message.success(
        failedCount
          ? `Downloaded ${savedCount} files, ${failedCount} failed`
          : `Downloaded ${savedCount} files`
      );
    }
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
          <Text strong className="text-[11px] truncate">
            {url.split('/').pop() || url}
          </Text>
          <Text type="secondary" className="text-[9px] truncate">
            {url}
          </Text>
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: (type: string) => (
        <Tag color="blue" className="text-[9px] m-0 border-none bg-blue-50 text-blue-500 uppercase font-bold">
          {type}
        </Tag>
      ),
    },
    {
      title: 'Origin',
      dataIndex: 'origin',
      key: 'origin',
      width: 64,
      render: (origin: string) => (
        <Text className="text-[9px] uppercase text-slate-400">{origin}</Text>
      ),
    },
  ];

  const resourceStats = useMemo(
    () => ({
      total: resources.length,
      images: resources.filter((r) => r.type === 'image').length,
      scripts: resources.filter((r) => r.type === 'script').length,
      styles: resources.filter((r) => r.type === 'stylesheet').length,
      network: resources.filter((r) => r.origin === 'network').length,
    }),
    [resources]
  );

  const targetMismatch =
    session &&
    activeTab.tabId &&
    session.tabId !== activeTab.tabId &&
    !isMonitoring;

  const menuItems = [
    {
      key: 'main',
      label: <TabNavLabel icon={LayoutDashboard}>Overview</TabNavLabel>,
      children: (
        <div className="sidepanel-scroll-pane bg-slate-50/30">
          <section className="sidepanel-section-card sidepanel-stats-section">
            <Text strong className="sidepanel-section-title">
              Statistics
            </Text>
            <div className="sidepanel-stats-grid">
              {[
                { label: 'Total resources', value: resourceStats.total, icon: Layers, tone: 'blue' },
                { label: 'Network (live)', value: resourceStats.network, icon: Radio, tone: 'violet' },
                { label: 'Images', value: resourceStats.images, icon: ImageIcon, tone: 'emerald' },
                {
                  label: 'Script / CSS',
                  value: resourceStats.scripts + resourceStats.styles,
                  icon: FileCode2,
                  tone: 'amber',
                },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className={`sidepanel-stat-card sidepanel-stat-card--${stat.tone}`}>
                    <div className="sidepanel-stat-icon" aria-hidden>
                      <Icon size={16} strokeWidth={2.25} />
                    </div>
                    <Text className="sidepanel-stat-value">{stat.value}</Text>
                    <Text type="secondary" className="sidepanel-stat-label">
                      {stat.label}
                    </Text>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sidepanel-section-card mb-4">
            <div className="flex justify-between items-center mb-3">
              <Text strong className="sidepanel-section-title !mb-0">
                Target Website
              </Text>
              <div className="flex items-center gap-1">
                {isMonitoring ? (
                  <>
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    <Text className="text-[10px] text-green-600 font-bold">LIVE</Text>
                  </>
                ) : (
                  <Text className="text-[10px] text-slate-400 font-bold">IDLE</Text>
                )}
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mb-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                  <GlobalOutlined />
                </div>
                <div className="min-w-0 flex-1">
                  <Text strong className="text-[11px] block truncate text-slate-800">
                    {targetTitle || targetHost || 'No tab'}
                  </Text>
                  <Text ellipsis type="secondary" className="text-[10px] font-medium block">
                    {targetUrl || 'Open an http(s) page, then tap “Use current tab”'}
                  </Text>
                  {targetTabId && (
                    <Text type="secondary" className="text-[9px]">
                      Tab #{targetTabId}
                    </Text>
                  )}
                </div>
              </div>
              {targetMismatch && (
                <Text className="text-[10px] text-amber-600 block mt-2">
                  Active tab differs from target — tap “Use current tab” to switch.
                </Text>
              )}
              {targetRestricted && (
                <Text className="text-[10px] text-red-500 block mt-2">
                  Internal browser pages cannot be monitored.
                </Text>
              )}
            </div>

            <Button
              icon={<AimOutlined />}
              block
              size="large"
              className="sidepanel-action-btn mb-3"
              onClick={() => void handlePinCurrentTab()}
              disabled={activeTab.restricted}
            >
              Use current tab as target
            </Button>

            <Text strong className="text-slate-700 text-xs block mb-2">
              Capture task
            </Text>
            <div className="sidepanel-task-actions">
              <Select
                className="sidepanel-task-select"
              size="large"
              value={selectedTask}
              onChange={setSelectedTask}
              disabled={isMonitoring}
              optionLabelProp="title"
              options={TASK_OPTIONS.map((o) => ({
                value: o.value,
                title: o.label,
                label: (
                  <div className="py-0.5">
                    <div className="font-medium text-xs leading-snug">{o.label}</div>
                    <div className="text-[10px] text-slate-400 leading-snug">{o.description}</div>
                  </div>
                ),
              }))}
              />
              {isMonitoring ? (
                <Button
                  danger
                  icon={<PauseCircleOutlined />}
                  block
                  size="large"
                  className="sidepanel-action-btn"
                  onClick={() => void handleStopTask()}
                >
                  Stop network monitoring
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  block
                  size="large"
                  className="sidepanel-action-btn"
                  loading={loading}
                  disabled={targetRestricted || !targetTabId}
                  onClick={() => void handleStartTask()}
                >
                  {selectedTask === 'network-live' ? 'Start monitoring' : 'Run DOM scan'}
                </Button>
              )}
              <Button
                icon={<ReloadOutlined />}
                block
                size="large"
                className="sidepanel-action-btn"
                loading={loading}
                disabled={!targetTabId || targetRestricted}
                onClick={() => void handleRefreshDom()}
              >
                Rescan DOM
              </Button>
            </div>
          </section>

          <div className="space-y-3 pt-2">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownloadAll}
              loading={isDownloading}
              block
              disabled={filteredResources.length === 0}
              className="rounded-xl h-14 font-bold bg-gradient-to-r from-blue-600 to-indigo-600 border-none shadow-xl shadow-blue-200"
            >
              {isDownloading ? `Downloading... ${downloadProgress}%` : `Download all (${filteredResources.length})`}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void syncFromBackground()}
              block
              className="rounded-xl h-12 font-medium border-slate-200 bg-white"
            >
              Sync resource list
            </Button>
          </div>
        </div>
      ),
    },
    {
      key: 'resources',
      label: (
        <TabNavLabel icon={Files} count={filteredResources.length}>
          Resources
        </TabNavLabel>
      ),
      children: (
        <div className="p-0 flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
          <div className="p-3 border-b border-slate-100 bg-slate-50/50">
            <Input
              placeholder="Filter resources..."
              prefix={<FilterOutlined className="text-slate-400" />}
              size="small"
              className="rounded-lg border-slate-200"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
          </div>
          <div className="flex-[0.6] overflow-auto p-2 border-b border-slate-100">
            <div className="px-2 mb-2">
              <Text type="secondary" className="text-[10px] uppercase font-bold tracking-wider">
                Source Tree
              </Text>
            </div>
            {treeData.length > 0 ? (
              <Tree
                showIcon
                blockNode
                autoExpandParent
                treeData={treeData}
                selectedKeys={selectedTreeKeys}
                onSelect={(keys) => setSelectedTreeKeys(keys as string[])}
                icon={(nodeProps: { isLeaf?: boolean }) =>
                  nodeProps.isLeaf ? <FileOutlined /> : <FolderOutlined />
                }
                className="bg-transparent text-slate-600 text-[11px] source-tree"
              />
            ) : (
              <Empty
                description="No resources yet — pick a task and start monitoring"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                className="mt-4"
              />
            )}
          </div>
          <Divider className="m-0" />
          <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
            <Text type="secondary" className="text-[10px]">
              Showing <span className="font-bold text-blue-500">{filteredResources.length}</span> /{' '}
              {resources.length}
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
              <Progress percent={downloadProgress} size="small" showInfo={true} strokeColor="#3b82f6" />
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout className="sidepanel-layout h-screen bg-white">
      <Header className="sidepanel-header !bg-white border-b border-slate-100">
        <div className="flex items-center justify-between gap-3 min-h-[56px] px-4 py-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="sidepanel-brand-icon shrink-0">
              <img
                src={EXT_ICON_URL}
                alt=""
                width={40}
                height={40}
                className="w-10 h-10 rounded-xl object-cover block"
              />
            </div>
            <div className="min-w-0">
              <Title level={5} className="!m-0 !leading-tight text-slate-900 font-bold truncate">
                Resources Saver
              </Title>
              <Text className="text-slate-400 text-[10px] font-medium block truncate">
                Sidepanel · Current tab
              </Text>
            </div>
          </div>
          <button
            type="button"
            aria-label="Settings"
            className="sidepanel-settings-btn shrink-0"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings size={20} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </Header>

      <Content className="sidepanel-content flex flex-col min-h-0 flex-1 overflow-hidden bg-white">
        <Tabs
          defaultActiveKey="main"
          className="side-panel-tabs flex-1 min-h-0"
          tabBarStyle={{ marginBottom: 0, borderBottom: '1px solid #f1f5f9', padding: '0 16px' }}
          items={menuItems}
        />
      </Content>

      <Footer className="sidepanel-footer py-3 px-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
        <Text className="text-[10px] text-slate-400 font-bold uppercase">v0.0.1</Text>
        <Space size="small">
          <div
            className={`w-1.5 h-1.5 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}
          />
          <Text className="text-[10px] text-slate-500 font-medium">
            {isMonitoring ? 'Monitoring' : 'Ready'}
          </Text>
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
              if (!selectedResource || !targetTabId) return;
              const resolved = resolveURLToPath(selectedResource.url, selectedResource.type);
              
              let finalPath = resolved.path;

              const bytes = await loadResourceBytesForTab(targetTabId, selectedResource.url);
              try {
                if (bytes) {
                  await downloadBlob(
                    new Blob([bytes.data], {
                      type: mimeTypeForDownload(selectedResource.url, selectedResource.type),
                    }),
                    finalPath
                  );
                } else {
                  await downloadUrl(selectedResource.url, finalPath);
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
        {selectedResource?.type === 'image' && (
          <div className="bg-slate-50 p-4 rounded-xl flex justify-center border border-slate-100 mb-3">
            <img src={selectedResource.url} alt="" className="max-h-[150px] max-w-full rounded-lg" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
            <Text type="secondary" className="text-[10px] block uppercase font-bold">
              Type
            </Text>
            <Tag color="blue" className="text-[10px] m-0">
              {selectedResource?.type}
            </Tag>
          </div>
          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
            <Text type="secondary" className="text-[10px] block uppercase font-bold">
              Origin
            </Text>
            <Text className="text-[10px]">{selectedResource?.origin}</Text>
          </div>
        </div>
      </Drawer>

      <Modal
        title="Settings"
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsSettingsOpen(false)}>
            Close
          </Button>,
        ]}
        width={320}
        centered
      >
        <div className="py-4 space-y-4">
          <div className="flex items-center justify-between">
            <Text strong className="text-xs block">
              Download shelf
            </Text>
            <Switch
              size="small"
              checked={settings.autoOpenShelf}
              onChange={(checked) => updateSettings({ autoOpenShelf: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Text strong className="text-xs block">
              Save as ZIP
            </Text>
            <Switch
              size="small"
              checked={settings.zipEnabled}
              onChange={(checked) => updateSettings({ zipEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Text strong className="text-xs block">
              Debug log
            </Text>
            <Switch
              size="small"
              checked={settings.debugMode}
              onChange={(checked) => updateSettings({ debugMode: checked })}
            />
          </div>
          <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
            <Space align="start">
              <InfoCircleOutlined className="text-blue-500" />
              <Text className="text-[10px] text-blue-700 leading-tight">
                Target Website is pinned to the tab you choose. “Network monitor” records that
                tab&apos;s requests until you tap Stop.
              </Text>
            </Space>
          </div>
        </div>
      </Modal>

      <style>{`
        .sidepanel-layout,
        .sidepanel-layout .ant-layout-header,
        .sidepanel-layout .ant-layout-content,
        .sidepanel-layout .ant-layout-footer {
          color-scheme: light;
        }
        .sidepanel-layout.ant-layout {
          display: flex !important;
          flex-direction: column !important;
          height: 100vh !important;
          max-height: 100vh !important;
          overflow: hidden !important;
        }
        .sidepanel-layout .ant-layout-header,
        .sidepanel-footer.ant-layout-footer {
          flex-shrink: 0;
        }
        .sidepanel-content.ant-layout-content {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
        .side-panel-tabs.ant-tabs {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          height: 100% !important;
        }
        .side-panel-tabs > .ant-tabs-nav {
          flex-shrink: 0;
        }
        .sidepanel-scroll-pane {
          padding: 16px;
          padding-bottom: 20px;
        }
        .sidepanel-header.ant-layout-header {
          height: auto !important;
          line-height: normal !important;
          padding: 0 !important;
          overflow: visible !important;
          background: #ffffff !important;
          color: #0f172a !important;
        }
        .sidepanel-header .ant-typography {
          color: inherit;
        }
        .sidepanel-header .ant-typography-secondary {
          color: #64748b !important;
        }
        .sidepanel-brand-icon {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sidepanel-settings-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          background: #f8fafc;
          color: #475569;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .sidepanel-settings-btn:hover {
          background: #e2e8f0;
          border-color: #94a3b8;
          color: #1e293b;
        }
        .sidepanel-settings-btn:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
        .sidepanel-settings-btn svg {
          stroke: currentColor;
          flex-shrink: 0;
        }
        .side-panel-tabs .ant-tabs-nav::before { border-bottom: none; }
        .side-panel-tabs .ant-tabs-tab {
          padding: 12px 14px !important;
          margin: 0 !important;
          font-weight: 600;
          color: #94a3b8;
        }
        .side-panel-tabs .ant-tabs-tab-btn {
          display: flex !important;
          align-items: center !important;
          outline: none;
        }
        .side-panel-tabs .ant-tabs-tab-active { color: #2563eb !important; }
        .side-panel-tabs .ant-tabs-tab-active .sidepanel-tab-label { color: #2563eb; }
        .side-panel-tabs .ant-tabs-ink-bar {
          height: 3px !important;
          border-radius: 3px 3px 0 0;
          background: #2563eb !important;
        }
        .side-panel-tabs .ant-tabs-content-holder {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          overflow: hidden !important;
        }
        .side-panel-tabs .ant-tabs-content {
          flex: 1 1 auto !important;
          min-height: 0 !important;
          height: 100% !important;
        }
        .side-panel-tabs .ant-tabs-tabpane {
          height: 100% !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .side-panel-tabs .ant-tabs-tabpane::-webkit-scrollbar {
          width: 6px;
        }
        .side-panel-tabs .ant-tabs-tabpane::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 999px;
        }
        .side-panel-tabs .ant-tabs-tabpane::-webkit-scrollbar-track {
          background: transparent;
        }
        .sidepanel-tab-label {
          line-height: 1.25;
          vertical-align: middle;
        }
        .sidepanel-tab-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 9999px;
          background: #3b82f6;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
        }
        .sidepanel-section-card {
          width: 100%;
          background: #fff;
          border: 1px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .sidepanel-section-title {
          display: block;
          margin: 0 0 12px 0 !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          color: #334155 !important;
        }
        .sidepanel-stats-section {
          margin-bottom: 12px;
        }
        .sidepanel-stats-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
        }
        .sidepanel-stat-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 4px;
          min-height: 76px;
          padding: 12px 8px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .sidepanel-stat-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          margin-bottom: 2px;
        }
        .sidepanel-stat-card--blue .sidepanel-stat-icon {
          background: #dbeafe;
          color: #2563eb;
        }
        .sidepanel-stat-card--violet .sidepanel-stat-icon {
          background: #ede9fe;
          color: #7c3aed;
        }
        .sidepanel-stat-card--emerald .sidepanel-stat-icon {
          background: #d1fae5;
          color: #059669;
        }
        .sidepanel-stat-card--amber .sidepanel-stat-icon {
          background: #fef3c7;
          color: #d97706;
        }
        .sidepanel-stat-label {
          display: block !important;
          margin: 0 !important;
          font-size: 10px !important;
          line-height: 1.25 !important;
          font-weight: 600 !important;
          color: #64748b !important;
          text-transform: none !important;
          letter-spacing: 0 !important;
        }
        .sidepanel-stat-value {
          display: block;
          margin: 0;
          font-size: 24px !important;
          line-height: 1 !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          font-variant-numeric: tabular-nums;
        }
        .sidepanel-task-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }
        .sidepanel-task-select {
          width: 100% !important;
        }
        .sidepanel-task-select.ant-select-large {
          width: 100% !important;
        }
        .sidepanel-task-select .ant-select-selector {
          width: 100% !important;
          min-height: 44px !important;
          height: auto !important;
          padding: 6px 36px 6px 14px !important;
          border-radius: 12px !important;
          border-color: #e2e8f0 !important;
          align-items: center !important;
        }
        .sidepanel-task-select.ant-select-focused .ant-select-selector {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15) !important;
        }
        .sidepanel-task-select .ant-select-selection-item {
          line-height: 1.3 !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding-inline-end: 0 !important;
        }
        .sidepanel-task-select .ant-select-arrow {
          inset-inline-end: 12px !important;
          color: #94a3b8 !important;
        }
        .sidepanel-action-btn.ant-btn {
          width: 100% !important;
          height: 44px !important;
          border-radius: 12px !important;
          font-weight: 600 !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .sidepanel-action-btn.ant-btn-default:not(:disabled) {
          border-color: #e2e8f0 !important;
          color: #334155 !important;
        }
        .resource-table-mini .ant-table-thead > tr > th {
          font-size: 10px;
          padding: 12px 8px;
          background: #f8fafc;
        }
        .resource-table-mini .ant-table-tbody > tr > td {
          padding: 10px 8px;
          cursor: pointer;
        }
        .source-tree .ant-tree-node-selected {
          background: #eff6ff !important;
          color: #2563eb !important;
        }
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

const rootElement =
  document.getElementById('root') ||
  (() => {
    const el = document.createElement('div');
    el.id = 'root';
    document.body.appendChild(el);
    return el;
  })();

const rootKey = '__RESOURCES_SAVER_SIDEPANEL_ROOT__';
let root = (window as Window & { [key: string]: unknown })[rootKey] as ReturnType<
  typeof ReactDOM.createRoot
> | undefined;

if (!root && rootElement) {
  root = ReactDOM.createRoot(rootElement);
  (window as Window & { [key: string]: unknown })[rootKey] = root;
}

root?.render(<SidePanelWrapper />);
