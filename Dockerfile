FROM python:3.12-slim-bookworm

ARG USER_ID=1000
ARG GROUP_ID=1000

RUN groupadd --gid "${GROUP_ID}" developer \
    && useradd \
        --uid "${USER_ID}" \
        --gid developer \
        --create-home \
        --shell /bin/bash \
        developer \
    && mkdir -p /workspace /home/developer/.config/whoop \
    && chown -R developer:developer /workspace /home/developer

WORKDIR /workspace
USER developer

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

CMD ["bash"]
