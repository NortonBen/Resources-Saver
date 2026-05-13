import React, { useState, useEffect, StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { Card, Button, Typography, Space, Divider, Tag, Switch, Tabs, QRCode, Input } from 'antd';
import { 
  DownloadOutlined, 
  SettingOutlined, 
  FolderOpenOutlined,
  ReloadOutlined,
  GlobalOutlined,
  FileZipOutlined,
  ShareAltOutlined,
  EditOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Share2, FileText, Settings } from 'lucide-react';
import './assets/main.css';

const { Title, Text } = Typography;

const Popup = () => {
  const [loading, setLoading] = React.useState(false);
  const [xhrEnabled, setXhrEnabled] = React.useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [notes, setNotes] = useState('# My Notes\n\n- Resource collection started.\n- Target: Current Tab.');

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) setCurrentUrl(tabs[0].url);
    });
  }, []);

  const handleSaveAll = () => {
    setLoading(true);
    // Logic will be implemented in devtools/background
    setTimeout(() => setLoading(false), 1000);
  };

  return (
    <Card 
      style={{ width: 380, borderRadius: 16, overflow: 'hidden' }}
      bodyStyle={{ padding: '0' }}
      className="shadow-2xl border-none bg-white"
    >
      <div className="p-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="flex items-center justify-between">
          <Space size="middle">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <DownloadOutlined style={{ color: 'white', fontSize: 22 }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: 'white' }}>Resources Saver</Title>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>Professional Asset Downloader</Text>
            </div>
          </Space>
          <Button 
            type="text" 
            icon={<Settings size={18} color="white" />} 
            className="hover:bg-white/10"
          />
        </div>
      </div>

      <div className="p-4">
        <Tabs
          defaultActiveKey="1"
          items={[
            {
              key: '1',
              label: <Space><ThunderboltOutlined /> Main</Space>,
              children: (
                <div className="animate-in fade-in duration-500">
                  <div className="bg-slate-50 p-3 rounded-2xl mb-4 border border-slate-100">
                    <div className="flex justify-between items-center mb-1">
                      <Text strong className="text-slate-600"><GlobalOutlined className="mr-2" /> Current Tab</Text>
                      <Tag color="blue" className="rounded-full border-none px-2">Active</Tag>
                    </div>
                    <Text ellipsis type="secondary" className="text-xs">{currentUrl}</Text>
                  </div>

                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div className="flex items-center justify-between px-1">
                      <Space>
                        <ReloadOutlined className="text-blue-500" />
                        <Text className="text-sm font-medium">Collect XHR Requests</Text>
                      </Space>
                      <Switch checked={xhrEnabled} onChange={setXhrEnabled} size="small" />
                    </div>

                    <Divider style={{ margin: '8px 0' }} />

                    <div className="grid grid-cols-2 gap-3">
                      <Button 
                        type="primary" 
                        icon={<DownloadOutlined />} 
                        onClick={handleSaveAll}
                        loading={loading}
                        block
                        className="rounded-xl h-11 font-semibold bg-blue-600 hover:bg-blue-700 border-none shadow-lg shadow-blue-200"
                      >
                        Save All
                      </Button>
                      <Button 
                        icon={<FileZipOutlined />} 
                        block
                        className="rounded-xl h-11 font-medium hover:text-blue-600 hover:border-blue-600"
                      >
                        ZIP All
                      </Button>
                    </div>

                    <Button 
                      type="text" 
                      icon={<FolderOpenOutlined />} 
                      block
                      className="rounded-xl h-10 text-slate-500 hover:bg-slate-50"
                    >
                      Open Downloads Folder
                    </Button>
                  </Space>
                </div>
              ),
            },
            {
              key: '2',
              label: <Space><Share2 size={14} /> Share</Space>,
              children: (
                <div className="flex flex-col items-center justify-center p-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="p-4 bg-white rounded-2xl shadow-xl border border-slate-100 mb-4">
                    <QRCode value={currentUrl || 'https://wxt.dev'} size={160} bordered={false} color="#1d4ed8" />
                  </div>
                  <Text type="secondary" className="text-center text-xs px-4 mb-4">
                    Scan this QR code to quickly open this tab's URL on another device.
                  </Text>
                  <Button icon={<ShareAltOutlined />} block className="rounded-xl h-10">
                    Copy Tab URL
                  </Button>
                </div>
              ),
            },
            {
              key: '3',
              label: <Space><FileText size={14} /> Notes</Space>,
              children: (
                <div className="p-2 animate-in fade-in duration-300">
                  <div className="mb-4">
                    <Input.TextArea 
                      value={notes} 
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Enter markdown notes here..."
                      autoSize={{ minRows: 3, maxRows: 6 }}
                      className="rounded-xl border-slate-200 mb-3"
                    />
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl prose prose-sm max-h-[150px] overflow-auto border border-slate-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>

      <div className="mt-4 p-4 bg-slate-50 border-t border-slate-100 text-center">
        <Text type="secondary" style={{ fontSize: '11px' }} className="text-slate-400">
          Tip: Open DevTools (F12) &gt; <b>Resources Saver</b> for advanced scraping.
        </Text>
      </div>
    </Card>
  );
};

const rootElement = document.getElementById('root') || (() => {
  const el = document.createElement('div');
  el.id = 'root';
  document.body.appendChild(el);
  return el;
})();

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
