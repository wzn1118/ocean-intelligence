assetDirectory = fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets");
testDirectory = fileparts(mfilename("fullpath"));
addpath(assetDirectory, testDirectory);
full100_export_contracts(fullfile(pwd, "full100-export-artifacts"), true);
