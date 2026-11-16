#!/usr/bin/env python3
"""
一键部署到 Netlify Drop（匿名，无需注册）
运行: python3 deploy_netlify.py
"""
import subprocess
import sys
import os
import json
import urllib.request
import uuid

SITE_DIR = os.path.dirname(os.path.abspath(__file__))

def main():
    if not os.path.isdir(SITE_DIR):
        print(f"❌ 找不到网站目录: {SITE_DIR}")
        return False

    print(f"📦 准备部署目录: {SITE_DIR}")
    print()

    # 检查 curl 是否可用
    try:
        subprocess.run(["curl", "--version"], capture_output=True, check=True)
    except:
        print("❌ 需要 curl 命令")
        return False

    # 先创建一个 drop
    print("🌐 连接 Netlify...")
    boundary = "----boundary7MAyrXRhQaHF0IJpGC2gw"
    
    # 构建 multipart form-data
    form_data = f"--{boundary}\r\n"
    form_data += f'Content-Disposition: form-data; name="type"\r\n\r\n'
    form_data += f"static\r\n"
    form_data += f"--{boundary}--\r\n"
    
    data = form_data.encode()
    
    req = urllib.request.Request(
        "https://api.netlify.com/api/v1/drops",
        data=data,
        method="POST"
    )
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Accept", "application/json")
    
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        drop_info = json.loads(resp.read())
        upload_url = drop_info.get("upload_url")
        site_name = drop_info.get("name")
    except Exception as e:
        print(f"❌ 创建 drop 失败: {e}")
        # 尝试备用方式
        print("🔄 尝试备用方式...")
        return deploy_via_curl()

    if not upload_url:
        print(f"❌ 没拿到 upload_url: {drop_info}")
        return False

    print(f"✅ Drop 创建成功: {site_name}")
    print("📤 上传文件...")

    # 上传 zip
    zip_path = "/tmp/mengli-youzhi.zip"
    # 打包整个 SITE_DIR
    subprocess.run(
        ["zip", "-r", zip_path, ".", "-x", ".*", "__MACOSX/*", "deploy_netlify.py"],
        cwd=SITE_DIR,
        capture_output=True,
        check=True
    )

    try:
        with open(zip_path, "rb") as f:
            file_data = f.read()
        
        req2 = urllib.request.Request(
            upload_url,
            data=file_data,
            method="PUT"
        )
        req2.add_header("Content-Type", "application/zip")
        req2.add_header("Content-Length", str(len(file_data)))
        
        resp2 = urllib.request.urlopen(req2, timeout=60)
        result = json.loads(resp2.read())
        
        url = result.get("url")
        admin_url = result.get("admin_url")
        
        print()
        print("=" * 50)
        print("🎉 部署成功！")
        print("=" * 50)
        print()
        print(f"🌐 访问地址: {url}")
        print(f"🛠️  管理后台: {admin_url}")
        print()
        print("⚠️  注意: 这个链接是临时的，可能会过期")
        print("    要固定链接请访问管理后台 claim 这个站点")
        print("=" * 50)
        
        return True
        
    except Exception as e:
        print(f"❌ 上传失败: {e}")
        return False


def deploy_via_curl():
    """备用：直接用 curl 尝试"""
    print("尝试用 curl 上传到 Netlify Drop...")
    
    # 先确保 zip 存在
    zip_path = "/tmp/mengli-youzhi.zip"
    if not os.path.exists(zip_path):
        os.chdir(os.path.dirname(SITE_DIR))
        subprocess.run(["zip", "-r", zip_path, "mengli-youzhi/", "-x", ".*", "__MACOSX/*"], check=True)
    
    # 用 curl 上传
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", 
         "https://api.netlify.com/api/v1/drops",
         "-F", "type=static",
         "--output", "/tmp/netlify_drop.json"],
        capture_output=True,
        text=True
    )
    
    if os.path.exists("/tmp/netlify_drop.json"):
        with open("/tmp/netlify_drop.json") as f:
            try:
                drop = json.load(f)
                upload_url = drop.get("upload_url")
                if upload_url:
                    result2 = subprocess.run(
                        ["curl", "-s", "-X", "PUT", upload_url,
                         "-H", "Content-Type: application/zip",
                         "--data-binary", f"@{zip_path}"],
                        capture_output=True,
                        text=True
                    )
                    print(result2.stdout)
                    return True
            except:
                pass
    
    print("❌ curl 方式也失败了")
    return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
