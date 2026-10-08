# Pomodoro

a cute, customizable pomodoro

images drawn by @sxwng

## running

to control apple music via the pomodoro, first make a certificate for the helper (once):

``` bash
brew install mkcert
mkcert -install
mkdir -p .certs
mkcert -cert-file .certs/cert.pem -key-file .certs/key.pem 127.0.0.1 localhost
```

then run

``` bash
node music-helper.js
```

in the terminal. then open https://sxwng.github.io/pomydoro and make sure your browser is allowed to notify in system settings -> notifications.