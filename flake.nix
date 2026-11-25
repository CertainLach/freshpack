{
  description = "freshpack";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
    shelly.url = "github:CertainLach/shelly";
    raphus = {
      url = "github:deltarocks/raphus";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = inputs.nixpkgs.lib.systems.flakeExposed;
      imports = [ inputs.shelly.flakeModule ];

      perSystem =
        {
          pkgs,
          lib,
          inputs',
          ...
        }:
        let
          chromium = lib.optional (lib.meta.availableOn pkgs.stdenv.hostPlatform pkgs.chromium) pkgs.chromium;
        in
        {
          shelly.shells.default = {
            packages = [
              inputs'.raphus.legacyPackages.deno
              inputs'.raphus.legacyPackages.pnpm
            ]
            ++ chromium;
            environment = lib.optionalAttrs (chromium != [ ]) {
              ASTRAL_BIN_PATH = "${pkgs.chromium}/bin/chromium";
            };
          };
        };
    };
}
