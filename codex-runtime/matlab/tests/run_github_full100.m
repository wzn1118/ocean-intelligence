function run_github_full100(expected_release, output_root, nonce)
%RUN_GITHUB_FULL100 Execute all licensed GitHub MATLAB runtime gates.
arguments
    expected_release (1,1) string
    output_root (1,1) string
    nonce (1,1) string
end

assert(string(version('-release')) == expected_release, ...
    "run_github_full100:Release", ...
    "Expected MATLAB %s, detected %s", expected_release, version('-release'));
assert(license('test', 'MATLAB') == 1, ...
    "run_github_full100:License", "Base MATLAB license is unavailable");
assert(strlength(strtrim(nonce)) >= 32, ...
    "run_github_full100:Nonce", "Evaluation nonce is invalid");

tests_directory = fileparts(mfilename("fullpath"));
matlab_directory = fileparts(tests_directory);
runtime_directory = fileparts(matlab_directory);
repository_root = fileparts(runtime_directory);
assets_directory = fullfile(matlab_directory, "assets");
eval_directory = fullfile(matlab_directory, "evals");
fixture_directory = fullfile(eval_directory, "fixtures");
interaction_directory = fullfile(repository_root, ".codex-evals", ...
    "matlab-100-20260905", "interaction");

output_root = string(output_root);
regression_directory = fullfile(output_root, "regression", "run");
family_b_directory = fullfile(output_root, "family-b");
export_directory = fullfile(output_root, "export");
interaction_output = fullfile(output_root, "interaction-headless");
evaluator_output = fullfile(output_root, "evaluator-runtime");
directories = [regression_directory family_b_directory export_directory ...
    interaction_output evaluator_output];
for directory = directories
    if ~isfolder(directory)
        mkdir(directory);
    end
end

addpath(assets_directory, tests_directory, eval_directory, interaction_directory);
old_directory = pwd;
directory_cleanup = onCleanup(@() cd(old_directory));
old_visibility = get(0, "DefaultFigureVisible");
visibility_cleanup = onCleanup(@() set(0, "DefaultFigureVisible", old_visibility));
set(0, "DefaultFigureVisible", "off");

probe = struct( ...
    "runtime", "matlab", ...
    "vendor", "MathWorks", ...
    "release", string(version('-release')), ...
    "version", string(version), ...
    "executable", string(fullfile(matlabroot, "bin", "matlab")), ...
    "jvm_available", logical(usejava("jvm")), ...
    "desktop_available", logical(usejava("desktop")), ...
    "display_available", strlength(string(getenv("DISPLAY"))) > 0, ...
    "headless", true, ...
    "non_interactive", true, ...
    "figure_visible", false, ...
    "matlab_license_tested", true, ...
    "matlab_license_available", logical(license('test', 'MATLAB')), ...
    "products", product_records(ver));
write_json(fullfile(output_root, "matlab-runtime-probe.json"), probe);

run_plot_regression(regression_directory);
full100_family_a_contracts;
full100_family_b_runtime(family_b_directory);
full100_family_c_contracts;
cd(export_directory);
run(fullfile(tests_directory, "full100_export_runtime_gate.m"));
cd(repository_root);
run_interaction_acceptance("headless", interaction_output);
run_matlab_gate(fixture_directory, evaluator_output, nonce);

clear visibility_cleanup directory_cleanup;
fprintf("MATLAB_FULL100_RELEASE=%s\n", expected_release);
fprintf("MATLAB_FULL100_OUTPUT=%s\n", output_root);
end

function records = product_records(products)
records = arrayfun(@(product) struct( ...
    "name", string(product.Name), ...
    "version", string(product.Version)), products);
end

function write_json(path, payload)
file_id = fopen(path, "w", "n", "UTF-8");
assert(file_id >= 0, "run_github_full100:Write", ...
    "Unable to open JSON output: %s", path);
cleanup = onCleanup(@() fclose(file_id));
encoded = jsonencode(payload);
written = fwrite(file_id, encoded, "char");
assert(written == strlength(string(encoded)), ...
    "run_github_full100:Write", "Incomplete JSON write: %s", path);
clear cleanup;
end
