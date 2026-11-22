#!/usr/bin/env python3
"""行为级冒烟测试：把"函数还在但被改坏了"这类事故也拦下来。

v130 的事故就是因为 mediaRelPath 还在、语法也对，但返回值少了一段，
静态检查发现不了。这里用固定输入直接跑这些函数，断言输出。

用法：python3 tools/smoke.py   （退出码非 0 表示有功能被改坏）
"""
import pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'social' / 'app.js'
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'

src = APP.read_text(encoding='utf-8')


def grab(pattern):
    m = re.search(pattern, src)
    return m.group(0) if m else ''


parts = []
parts.append("var GH = { owner: 'o', repo: 'r', branch: 'main', base: 'https://api.github.com' };")
for name in ['MEDIA_RAW_PREFIX', 'MEDIA_PAGES_PREFIX', 'MEDIA_CDN_PREFIX', 'MEDIA_KEY']:
    parts.append(grab(r'const %s = [^\n]*' % name))

for fn in ['mediaRelPath', 'mediaRenderUrl', 'mediaPagesUrl', 'mediaCdnUrl',
           'musicSources', 'formatMusicDuration', 'formatTime']:
    body = grab(r'function %s\([\s\S]*?\n\}' % fn)
    if not body:
        print(f'❌ 找不到函数 {fn}')
        sys.exit(1)
    parts.append(body)

RAW = 'https://raw.githubusercontent.com/o/r/main/social/media/1_x_img.jpg'

parts.append("""
var fails = [];
function eq(label, got, want) {
  if (got !== want) fails.push(label + ' 期望 ' + JSON.stringify(want) + '，实际 ' + JSON.stringify(got));
}
var raw = '%s';
eq('mediaRelPath', mediaRelPath(raw), 'media/1_x_img.jpg');
eq('mediaRelPath 带参数', mediaRelPath(raw + '?raw=true'), 'media/1_x_img.jpg');
eq('mediaPagesUrl', mediaPagesUrl(raw), 'https://o.github.io/r/social/media/1_x_img.jpg');
eq('mediaCdnUrl', mediaCdnUrl(raw), 'https://gcore.jsdelivr.net/gh/o/r@main/social/media/1_x_img.jpg');
eq('mediaRenderUrl', mediaRenderUrl(raw), 'https://o.github.io/r/social/media/1_x_img.jpg');
eq('musicSources 条数', musicSources(raw).length, 3);
eq('musicSources 首条', musicSources(raw)[0], 'https://o.github.io/r/social/media/1_x_img.jpg');
eq('时长格式', formatMusicDuration(65), '1:05');
eq('时长格式0', formatMusicDuration(0), '0:00');
var old = new Date(); old.setFullYear(old.getFullYear() - 1);
var s = formatTime(old.getTime());
if (s.indexOf('年') < 0) fails.push('跨年日期没有年份：' + s);
var today = formatTime(Date.now());
if (today.indexOf('年') >= 0) fails.push('今年日期不应带年份：' + today);
if (fails.length) { print('FAIL'); fails.forEach(f => print('  - ' + f)); } else { print('OK'); }
""" % RAW)

tmp = pathlib.Path(tempfile.mkdtemp()) / 'smoke.js'
tmp.write_text('\n'.join(parts), encoding='utf-8')
r = subprocess.run([JSC, str(tmp)], capture_output=True, text=True)
out = (r.stdout or '').strip()
if out.startswith('OK') and r.returncode == 0:
    print('✅ 行为冒烟测试通过')
    sys.exit(0)
print('❌ 行为冒烟测试未通过：')
print(out or r.stderr[:600])
sys.exit(1)
