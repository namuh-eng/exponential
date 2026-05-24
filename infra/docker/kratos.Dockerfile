FROM oryd/kratos:v1.3.1
COPY infra/kratos /etc/config/kratos
ENTRYPOINT ["kratos"]
CMD ["serve", "--config", "/etc/config/kratos/kratos.yml"]
