FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /profiles && chown pwuser:pwuser /profiles
COPY worker/*.mjs ./
USER pwuser
ENV PORT=3002 PROFILE_DIR=/profiles
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
