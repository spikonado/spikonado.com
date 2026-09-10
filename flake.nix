{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        formatter = pkgs.nixfmt-tree;

        devShells.default = pkgs.mkShell.override { stdenv = pkgs.clangStdenv; } (
          {
            name = "spikonado.com-shell";
            packages = with pkgs; [
              bun
              prek
            ];
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            # Sharp's prebuilt linux-x64 .node links GNU libstdc++. clangStdenv
            # only puts libc++ on the loader path, so dlopen fails without this.
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.gcc.cc.lib ];
          }
        );
      }
    );
  nixConfig = {
    extra-substituters = [
      "https://spikonado.cachix.org"
    ];
    extra-trusted-public-keys = [
      "spikonado.cachix.org-1:MwA4hqRN0+DdP7/UnTn0yvJgVu65S1S0QVnAnsguev4="
    ];
  };
}
