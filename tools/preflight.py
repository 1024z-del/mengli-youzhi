#!/usr/bin/env python3
"""提交前自检：把历史上真实踩过的坑做成自动检查，避免改动把已有功能打乱。

检查项：
 1. 版本号三处一致（index.html 内联 / app.js?v= / style.css?v= 不需要相等，但必须存在）
 2. app.js 语法正确（用系统 jsc）
 3. 顶层同名函数/常量重复定义（历史上 formatMusicDuration、MUSIC_ICONS 就是这么被打乱的）
 4. 关键功能符号仍然存在
"""
import re, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOCIAL = ROOT / 'social'
APP = SOCIAL / 'app.js'
HTML = SOCIAL / 'index.html'

REQUIRED = [
    'formatMusicDuration', 'musicBarHtml', 'voiceBarHtml', 'togglePostMusic',
    'togglePostVoice', 'musicSources', 'publishPost', 'renderFeed',
    'startRecording', 'stopRecording', 'openUserPage', 'imgFallbackAttr',
    'prefetchMedia', 'hydrateMediaCache', 'mediaPagesUrl', 'mediaCdnUrl',
]

errors = []
warns = []


def check_version():
    html = HTML.read_text(encoding='utf-8')
    m = re.search(r'CURRENT_V\s*=\s*(\d+)', html)
    a = re.search(r'app\.js\?v=(\d+)', html)
    s = re.search(r'style\.css\?v=(\d+)', html)
    if not m:
        errors.append('index.html 缺少 CURRENT_V')
        return
    if not a:
        errors.append('index.html 缺少 app.js?v= 版本参数')
        return
    if m.group(1) != a.group(1):
        errors.append(f'版本不一致：CURRENT_V={m.group(1)} 但 app.js?v={a.group(1)}（会导致无限刷新）')
    if not s:
        warns.append('index.html 没有给 style.css 带版本号')


def check_syntax():
    src = APP.read_text(encoding='utf-8')
    tmp = pathlib.Path(tempfile.mkdtemp()) / 'check.js'
    tmp.write_text('function __wrap(){\n' + src + '\n}\n', encoding='utf-8')
    jsc = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
    r = subprocess.run([jsc, str(tmp)], capture_output=True, text=True)
    if r.returncode != 0:
        errors.append('app.js 语法错误：' + (r.stderr.strip()[:400] or '未知'))


def check_duplicates():
    src = APP.read_text(encoding='utf-8')
    seen = {}
    for i, line in enumerate(src.splitlines(), 1):
        m = re.match(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', line)
        if not m:
            m = re.match(r'^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=', line)
        if m:
            name = m.group(1)
            seen.setdefault(name, []).append(i)
    dup = {k: v for k, v in seen.items() if len(v) > 1}
    for k, v in dup.items():
        errors.append(f'顶层重复定义 {k}（行 {v}），chrome 会静默覆盖前一个')


def check_required():
    src = APP.read_text(encoding='utf-8')
    for name in REQUIRED:
        if not re.search(r'(function\s+%s\s*\(|%s\s*=)' % (re.escape(name), re.escape(name)), src):
            errors.append(f'关键函数/常量丢失：{name}')


check_version()
check_syntax()
check_duplicates()
check_required()

for w in warns:
    print('⚠️  ' + w)
if errors:
    print('\n❌ 自检未通过：')
    for e in errors:
        print('  - ' + e)
    print('\n确认无误可用： git commit --no-verify')
    sys.exit(1)
print('✅ 自检通过')
