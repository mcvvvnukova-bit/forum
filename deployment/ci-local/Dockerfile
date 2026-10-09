FROM ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 iptables iproute2 procps curl ca-certificates git unzip xz-utils \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 \
    libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxkbcommon0 libxrandr2 xvfb libfontconfig1 libfreetype6 \
    fonts-noto-color-emoji fonts-unifont xfonts-cyrillic xfonts-scalable \
    fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    && gpasswd -d runner sudo \
    && SUDO_FORCE_REMOVE=yes apt-get purge -y sudo \
    && rm -rf /var/lib/apt/lists/* \
    && cp -a /home/runner /opt/runner-template
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL https://github.com/docker/compose/releases/download/v5.6.0/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose \
    && echo '733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2  /usr/local/lib/docker/cli-plugins/docker-compose' | sha256sum -c - \
    && chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
COPY job-started.sh validate-job.py /opt/astforum-ci/
RUN chown -R root:root /opt/astforum-ci && chmod 755 /opt/astforum-ci /opt/astforum-ci/job-started.sh && chmod 644 /opt/astforum-ci/validate-job.py
COPY entrypoint.sh /usr/local/bin/ci-local-entrypoint
RUN chmod 755 /usr/local/bin/ci-local-entrypoint
ENTRYPOINT ["/usr/local/bin/ci-local-entrypoint"]
CMD ["runner"]
