# Spikonado.com

## Running Locally

### Nix

Install Nix: https://nixos.org/nix/download.html

#### 1. Clone the repository

```bash
git clone https://github.com/spikonado/spikonado.com.git ~/spikonado.com
```

#### 2. Activate the nix environment

```bash
cd ~/spikonado.com
nix develop
```

#### 3. Start the website

```bash
cd ~/spikonado.com
pnpm i
pnpm dev
```
