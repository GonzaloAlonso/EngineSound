# Static site, no build step. Python's http.server is already what every
# local test in this project ran against — reusing it here instead of
# introducing a second web server (nginx, Caddy, ...) that then needs its
# own config file for what is, in the end, "serve some files."
FROM python:3-alpine

WORKDIR /srv
COPY . .

EXPOSE 8420
CMD ["python3", "-m", "http.server", "8420"]
