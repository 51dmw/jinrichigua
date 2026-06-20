import * as React from 'react';
import { Main, Box, Flex, Button, Typography, Textarea } from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

type BulkResult = {
  total: number;
  created: Array<{ name: string; slug: string }>;
  skipped: string[];
  truncated: boolean;
};

/**
 * 后台「批量添加标签」页面。
 * 粘贴标签名（每行一个，或用逗号/顿号分隔）→ 调 admin 路由 /tags-bulk-create →
 * 显示新建 / 跳过结果。slug 由后端 tag lifecycle 自动生成。
 */
const BulkTags = () => {
  const [text, setText] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const onSubmit = async () => {
    if (!text.trim()) {
      toggleNotification({ type: 'warning', message: '请先粘贴标签名' });
      return;
    }
    setLoading(true);
    try {
      const { data } = await post('/tags-bulk-create', { text });
      setResult(data as BulkResult);
      toggleNotification({
        type: 'success',
        message: `新建 ${data.created.length} 个，跳过 ${data.skipped.length} 个`,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? '批量添加失败';
      toggleNotification({ type: 'danger', message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Main>
      <Box padding={8}>
        <Box paddingBottom={4}>
          <Typography variant="alpha" tag="h1">
            批量添加标签
          </Typography>
          <Box paddingTop={2}>
            <Typography variant="omega" textColor="neutral600">
              每行一个标签名，或用逗号 , / 顿号 、 分隔。已存在的自动跳过；slug 自动生成拼音并去重。
            </Typography>
          </Box>
        </Box>

        <Box paddingBottom={4} maxWidth="60rem">
          <Textarea
            name="tags"
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            placeholder={'塌房\n明星\n爆料、反转、出圈'}
            rows={10}
          />
        </Box>

        <Flex gap={2}>
          <Button onClick={onSubmit} loading={loading} disabled={loading}>
            批量添加
          </Button>
          <Button variant="tertiary" onClick={() => { setText(''); setResult(null); }} disabled={loading}>
            清空
          </Button>
        </Flex>

        {result ? (
          <Box paddingTop={6} maxWidth="60rem">
            <Typography variant="delta" tag="h2">
              结果：共 {result.total} 个 · 新建 {result.created.length} · 跳过 {result.skipped.length}
              {result.truncated ? ' · 已截断至 500' : ''}
            </Typography>
            {result.created.length > 0 ? (
              <Box paddingTop={3}>
                <Typography variant="sigma" textColor="success600">
                  新建（name → slug）
                </Typography>
                <Box paddingTop={1}>
                  {result.created.map((c) => (
                    <Typography key={c.slug} variant="pi" tag="p" textColor="neutral700">
                      {c.name} → {c.slug}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ) : null}
            {result.skipped.length > 0 ? (
              <Box paddingTop={3}>
                <Typography variant="sigma" textColor="neutral600">
                  跳过（已存在）
                </Typography>
                <Box paddingTop={1}>
                  <Typography variant="pi" tag="p" textColor="neutral600">
                    {result.skipped.join('、')}
                  </Typography>
                </Box>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Main>
  );
};

export default BulkTags;
