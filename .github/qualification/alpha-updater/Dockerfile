FROM docker.io/library/node@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde
COPY jdk-21.0.13+9/ /opt/qualification-jdk/
ENV JAVA_HOME=/opt/qualification-jdk
ENV PATH=/opt/qualification-jdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /workspace
