FROM node:24-alpine

ENV NODE_ENV=production \
    IMAGE_JOB_HOST=0.0.0.0 \
    IMAGE_JOB_PORT=3001 \
    IMAGE_JOB_DATA_DIR=/var/lib/image-jobs

RUN addgroup -S -g 10001 imagejobs \
    && adduser -S -D -H -u 10001 -G imagejobs imagejobs \
    && mkdir -p /app/server /var/lib/image-jobs \
    && chown -R imagejobs:imagejobs /app /var/lib/image-jobs

WORKDIR /app

COPY --chown=imagejobs:imagejobs server/image-job-proxy.mjs server/main.mjs ./server/

USER 10001:10001

VOLUME ["/var/lib/image-jobs"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/healthz || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.mjs"]
