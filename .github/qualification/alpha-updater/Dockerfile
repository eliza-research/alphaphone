FROM docker.io/library/node@sha256:da81deb96d49fc84c9813bc4f16dfdb1d4d7e3671b74cd54fd944428f1444afe
COPY jdk-21.0.13+9/ /opt/qualification-jdk/
ENV JAVA_HOME=/opt/qualification-jdk
ENV PATH=/opt/qualification-jdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /workspace
