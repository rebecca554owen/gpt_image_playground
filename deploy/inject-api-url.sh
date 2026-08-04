#!/bin/sh

# 用环境变量替换前端默认 API URL。显式传入空字符串时保留为空。
if [ "${DEFAULT_API_URL+x}" != "x" ]; then
    DEFAULT_API_URL=${API_URL:-https://api.llm-token.cn/v1}
fi
DOCKER_LEGACY_API_URL_USED=${DOCKER_LEGACY_API_URL_USED:-false}
if [ -n "$API_URL" ]; then
    DOCKER_LEGACY_API_URL_USED=true
fi

API_PROXY_AVAILABLE=false
if [ "$ENABLE_API_PROXY" = "true" ]; then
    API_PROXY_AVAILABLE=true
fi

API_PROXY_LOCKED=false
if [ "$ENABLE_API_PROXY" = "true" ] && [ "$LOCK_API_PROXY" = "true" ]; then
    API_PROXY_LOCKED=true
fi

DEFAULT_CONFIG_ONLY=false
if [ "$SHOW_DEFAULT_CONFIG_ONLY" = "true" ]; then
    DEFAULT_CONFIG_ONLY=true
fi

IMAGE_JOBS_AVAILABLE=false
if [ "$ENABLE_API_PROXY" = "true" ] && [ "$ENABLE_IMAGE_JOBS" = "true" ]; then
    IMAGE_JOBS_AVAILABLE=true
fi

escape_sed_replacement() {
    printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

escape_js_string() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

DEFAULT_API_URL_ESCAPED=$(escape_sed_replacement "$(escape_js_string "$DEFAULT_API_URL")")

# 查找所有 js 文件并将占位符替换为运行时配置
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DEFAULT_API_URL_PLACEHOLDER__|$DEFAULT_API_URL_ESCAPED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__|$API_PROXY_AVAILABLE|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_API_PROXY_LOCKED_PLACEHOLDER__|$API_PROXY_LOCKED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__|true|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__|$DOCKER_LEGACY_API_URL_USED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_SHOW_DEFAULT_CONFIG_ONLY_PLACEHOLDER__|$DEFAULT_CONFIG_ONLY|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_IMAGE_JOBS_AVAILABLE_PLACEHOLDER__|$IMAGE_JOBS_AVAILABLE|g" {} +

# JS 文件名由构建内容生成，但运行时替换不会改变文件名。追加配置指纹，避免浏览器长期缓存旧配置。
RUNTIME_CONFIG_VERSION=$(printf '%s\n' \
    "$DEFAULT_API_URL" \
    "$API_PROXY_AVAILABLE" \
    "$API_PROXY_LOCKED" \
    "$DOCKER_LEGACY_API_URL_USED" \
    "$DEFAULT_CONFIG_ONLY" \
    "$IMAGE_JOBS_AVAILABLE" | cksum | awk '{print $1}')
sed -i 's|\.js?runtime=[^"]*"|.js"|g' /usr/share/nginx/html/index.html
sed -i "s|\.js\"|.js?runtime=$RUNTIME_CONFIG_VERSION\"|g" /usr/share/nginx/html/index.html

# 检查是否启用了 API 代理
if [ "$ENABLE_API_PROXY" != "true" ]; then
    # 删除代理配置块
    sed -i '/# BEGIN API PROXY/,/# END API PROXY/d' /etc/nginx/conf.d/default.conf
fi


if [ "$IMAGE_JOBS_AVAILABLE" != "true" ]; then
    sed -i '/# BEGIN IMAGE JOBS/,/# END IMAGE JOBS/d' /etc/nginx/conf.d/default.conf
fi

exec "$@"
