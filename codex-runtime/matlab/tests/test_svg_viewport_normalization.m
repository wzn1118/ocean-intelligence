function test_svg_viewport_normalization()
assetDirectory = fullfile(fileparts(fileparts(mfilename("fullpath"))), "assets");
addpath(assetDirectory);
temporaryDirectory = string(tempname);
mkdir(temporaryDirectory);
cleanup = onCleanup(@() rmdir(temporaryDirectory, "s"));
names = ["old-native" "modern-native" "display-native" "missing-viewbox" ...
    "matching-ratio" "matching-origin" "family-characters" "matching-stylesheet" ...
    "mismatched-origin"];
nativeBoxes = [0 0 239 147; 0 0 240 148; 0 0 267 200; 0 0 239 147; ...
    0 0 200 150; 10 20 240 148; 0 0 239 147; 0 0 200 150; 10 20 240 148];
targets = [997 613; 997 613; 400 300; 997 613; 400 300; 480 296; 997 613; 400 300; 997 613];
resolutions = [300 300 150 300 150 150 300 150 300];
aspects = ["xMidYMid meet" "" "xMidYMid meet" "xMidYMid meet" ...
    "none" "xMinYMin meet" "" "" "xMidYMid meet"];
normalize = [true true true true false false true false true];
for caseIndex = 1:numel(names)
    run_positive_case(temporaryDirectory, names(caseIndex), nativeBoxes(caseIndex, :), ...
        targets(caseIndex, :), resolutions(caseIndex), aspects(caseIndex), ...
        caseIndex ~= 4, normalize(caseIndex));
end
rejected = ["unknown-node" "stylesheet" "stylesheet-instruction" "script" ...
    "external-href" "external-xlink-href" "root-transform" "root-clip-path" ...
    "root-filter" "root-mask" "root-style-transform" "root-style-clip-path" ...
    "root-style-filter" "root-style-mask" "nested-svg" "percent-geometry" ...
    "percent-style" "percent-font-size" "em-font-size" "rem-font-size" ...
    "aspect-none" "aspect-alignment" "aspect-slice" "style-calc" "style-var" ...
    "style-important" "style-escape"];
for caseIndex = 1:numel(rejected)
    run_rejected_case(temporaryDirectory, rejected(caseIndex), ...
        "oi_annotate_svg:UnsupportedNormalization");
end
run_rejected_case(temporaryDirectory, "invalid-viewbox", "oi_annotate_svg:InvalidViewBox");
fprintf("MATLAB_SVG_VIEWPORT_NORMALIZATION=%s\n", jsonencode(struct( ...
    "status", "passed_synthetic_dom_only", "synthetic", true, ...
    "positive_cases", numel(names), "rejected_cases", numel(rejected) + 1, ...
    "rendered", false, "visual_verified", false)));
clear cleanup;
end

function run_positive_case(directory, name, nativeBox, target, dpi, aspect, includeBox, normalize)
filePath = fullfile(directory, name + ".svg");
document = synthetic_document(nativeBox, aspect, includeBox);
root = document.getDocumentElement();
fontFamily = "'DejaVu Sans'";
if name == "family-characters"
    fontFamily = "'Synthetic 100% em rem'";
    root.setAttribute('style', char("font-family:" + fontFamily ...
        + ";font-size:12px;stroke-linecap:round;fill:#182c33"));
elseif name == "matching-stylesheet"
    append_stylesheet(document, root);
end
xmlwrite(char(filePath), document);
source = xmlread(char(filePath));
sourcePayload = payload_signature(source.getDocumentElement(), true);
titleText = "Synthetic SVG < 20 & 12.5 > 2";
description = "Synthetic DOM fixture; not observations or visual validation; ""quoted"".";
points = target * 72 / dpi;
for iteration = 1:2
    returnedBox = oi_annotate_svg(filePath, titleText, description, ...
        points(1), points(2), target(1), target(2));
    verified = xmlread(char(filePath));
    result = verified.getDocumentElement();
    assert(isempty(verified.getDoctype()));
    assert(strcmp(char(result.getNamespaceURI()), 'http://www.w3.org/2000/svg'));
    assert(strcmp(char(result.getAttribute('id')), 'synthetic-root'));
    assert_metadata(result, target, points / 72, titleText, description, fontFamily);
    if normalize
        expectedBox = [0 0 target];
        assert(isequal(returnedBox, expectedBox) && isequal(read_viewbox(result), expectedBox), ...
            "test_svg_viewport_normalization:OuterViewBox", ...
            "The returned and serialized outer viewBox must match the target");
        assert(strcmp(char(result.getAttribute('data-viewport-normalization')), ...
            'nested-native-viewbox-v1'));
        assert(strcmp(char(result.getAttribute('preserveAspectRatio')), 'xMidYMid meet'));
        children = element_children(result);
        assert(numel(children) == 3 && strcmp(char(children{3}.getNodeName()), 'svg'), ...
            "test_svg_viewport_normalization:WrapperCount", ...
            "Only title, desc and one native viewport may remain at the root");
        assert(result.getElementsByTagName('svg').getLength() == 1, ...
            "test_svg_viewport_normalization:Idempotence", ...
            "Same-size reannotation must not nest another wrapper");
        viewport = children{3};
        assert(strcmp(char(viewport.getNamespaceURI()), 'http://www.w3.org/2000/svg'));
        assert(strcmp(char(viewport.getAttribute('data-native-viewbox')), 'true'));
        assert(isequal(read_viewbox(viewport), nativeBox));
        assert(strcmp(char(viewport.getAttribute('preserveAspectRatio')), char(aspect)));
        assert(strcmp(char(viewport.getAttribute('overflow')), 'visible'));
        assert(str2double(char(viewport.getAttribute('x'))) == 0 ...
            && str2double(char(viewport.getAttribute('y'))) == 0);
        assert(str2double(char(viewport.getAttribute('width'))) == target(1) ...
            && str2double(char(viewport.getAttribute('height'))) == target(2));
        assert(~viewport.hasAttribute('transform') && ~viewport.hasAttribute('style') ...
            && ~viewport.hasAttribute('font-size'), ...
            "test_svg_viewport_normalization:NeutralWrapper", ...
            "The native viewport must not add a transform or reapply inherited typography");
        resultPayload = payload_signature(viewport, false);
    else
        assert(isequal(returnedBox, nativeBox) && isequal(read_viewbox(result), nativeBox));
        assert(~result.hasAttribute('data-viewport-normalization'));
        assert(result.getElementsByTagName('svg').getLength() == 0);
        assert(strcmp(char(result.getAttribute('preserveAspectRatio')), char(aspect)), ...
            "test_svg_viewport_normalization:MatchingAspect", ...
            "A matching ratio must not trigger normalization or its restricted aspect profile");
        resultPayload = payload_signature(result, true);
    end
    assert(resultPayload == sourcePayload, ...
        "test_svg_viewport_normalization:PayloadChanged", ...
        "Synthetic graphic sequence, attributes, text and clip subtrees must remain unchanged: %s", name);
end
end

function run_rejected_case(directory, name, expectedIdentifier)
filePath = fullfile(directory, "reject-" + name + ".svg");
document = synthetic_document([0 0 239 147], "xMidYMid meet", true);
root = document.getDocumentElement();
textNode = root.getElementsByTagName('text').item(0);
switch name
    case "invalid-viewbox"
        root.setAttribute('viewBox', '0 0 239 147junk');
    case "unknown-node"
        root.appendChild(svg_element(document, 'foreignObject'));
    case "stylesheet"
        append_stylesheet(document, root);
    case "stylesheet-instruction"
        instruction = document.createProcessingInstruction('xml-stylesheet', ...
            'type="text/css" href="https://example.invalid/synthetic.css"');
        document.insertBefore(instruction, root);
    case "script"
        root.appendChild(svg_element(document, 'script'));
    case "external-href"
        textNode.setAttribute('href', 'https://example.invalid/synthetic.svg#text');
    case "external-xlink-href"
        root.setAttributeNS('http://www.w3.org/2000/xmlns/', ...
            'xmlns:xlink', 'http://www.w3.org/1999/xlink');
        textNode.setAttributeNS('http://www.w3.org/1999/xlink', ...
            'xlink:href', 'https://example.invalid/synthetic.svg#text');
    case {"root-transform", "root-clip-path", "root-filter", "root-mask"}
        property = extractAfter(name, "root-");
        if property == "transform"
            value = "translate(1 2)";
        else
            value = "url(#synthetic-clip)";
        end
        root.setAttribute(char(property), char(value));
    case {"root-style-transform", "root-style-clip-path", "root-style-filter", "root-style-mask"}
        property = extractAfter(name, "root-style-");
        if property == "transform"
            value = "translate(1px, 2px)";
        else
            value = "url(#synthetic-clip)";
        end
        root.setAttribute('style', char(string(char(root.getAttribute('style'))) ...
            + ";" + property + ":" + value));
    case "nested-svg"
        nested = svg_element(document, 'svg');
        nested.setAttribute('viewBox', '0 0 10 10');
        root.appendChild(nested);
    case "percent-geometry"
        textNode.setAttribute('x', '10%');
    case "percent-style"
        textNode.setAttribute('style', 'stroke-width:1%');
    case "percent-font-size"
        root.setAttribute('font-size', '120%');
    case "em-font-size"
        textNode.setAttribute('font-size', '1.25em');
    case "rem-font-size"
        textNode.setAttribute('style', 'font-size:1.25rem');
    case "aspect-none"
        root.setAttribute('preserveAspectRatio', 'none');
    case "aspect-alignment"
        root.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    case "aspect-slice"
        root.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    case "style-calc"
        textNode.setAttribute('style', 'font-size:calc(10px + 2px)');
    case "style-var"
        textNode.setAttribute('style', 'fill:var(--synthetic-ink)');
    case "style-important"
        textNode.setAttribute('style', 'font-size:12px !important');
    case "style-escape"
        textNode.setAttribute('style', 'font-family:Synthetic\ Font');
    otherwise
        error("test_svg_viewport_normalization:UnknownCase", "Unknown synthetic case: %s", name);
end
xmlwrite(char(filePath), document);
originalHash = oi_sha256_file(filePath);
originalBytes = dir(filePath).bytes;
caughtIdentifier = "";
try
    oi_annotate_svg(filePath, "Synthetic rejected input", "Not visual validation", ...
        997 * 72 / 300, 613 * 72 / 300, 997, 613);
catch exception
    caughtIdentifier = string(exception.identifier);
end
assert(strcmp(oi_sha256_file(filePath), originalHash) && dir(filePath).bytes == originalBytes, ...
    "test_svg_viewport_normalization:RejectedFileChanged", ...
    "Rejected input must retain its original bytes and SHA-256: %s", name);
assert(caughtIdentifier == expectedIdentifier, ...
    "test_svg_viewport_normalization:RejectionIdentifier", ...
    "Expected %s for %s, received '%s'", expectedIdentifier, name, caughtIdentifier);
end

function document = synthetic_document(nativeBox, aspect, includeBox)
document = com.mathworks.xml.XMLUtils.createDocument('svg');
root = document.getDocumentElement();
root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
root.setAttribute('id', 'synthetic-root');
root.setAttribute('width', sprintf('%.17gpt', nativeBox(3)));
root.setAttribute('height', sprintf('%.17gpt', nativeBox(4)));
if includeBox
    root.setAttribute('viewBox', sprintf('%.17g %.17g %.17g %.17g', nativeBox));
end
if strlength(aspect) > 0
    root.setAttribute('preserveAspectRatio', char(aspect));
end
root.setAttribute('style', ...
    'font-family:''DejaVu Sans'';font-size:12px;stroke-linecap:round;fill:#182c33');
titleNode = svg_element(document, 'title');
titleNode.appendChild(document.createTextNode('Stale synthetic title'));
root.appendChild(titleNode);
descriptionNode = svg_element(document, 'desc');
descriptionNode.appendChild(document.createTextNode('Stale synthetic description'));
root.appendChild(descriptionNode);
definitions = svg_element(document, 'defs');
clip = svg_element(document, 'clipPath');
clip.setAttribute('id', 'synthetic-clip');
clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
clipRectangle = svg_element(document, 'rect');
clipRectangle.setAttribute('x', '5');
clipRectangle.setAttribute('y', '6');
clipRectangle.setAttribute('width', '200');
clipRectangle.setAttribute('height', '110');
clip.appendChild(clipRectangle);
definitions.appendChild(clip);
root.appendChild(definitions);
background = svg_element(document, 'rect');
background.setAttribute('id', 'synthetic-background');
background.setAttribute('width', sprintf('%.17g', nativeBox(3)));
background.setAttribute('height', sprintf('%.17g', nativeBox(4)));
background.setAttribute('fill', 'white');
root.appendChild(background);
group = svg_element(document, 'g');
group.setAttribute('transform', 'translate(2 3)');
group.setAttribute('style', 'clip-path:url(#synthetic-clip)');
curve = svg_element(document, 'path');
curve.setAttribute('id', 'synthetic-curve');
curve.setAttribute('d', 'M 10 90 L 50 20 L 100 60');
curve.setAttribute('style', 'fill:none;stroke:#0077bb;stroke-width:1.5');
group.appendChild(curve);
polyline = svg_element(document, 'polyline');
polyline.setAttribute('points', '10,80 50,30 100,70');
polyline.setAttribute('fill', 'none');
polyline.setAttribute('stroke', '#cc3311');
group.appendChild(polyline);
textNode = svg_element(document, 'text');
textNode.setAttribute('id', 'synthetic-text');
textNode.setAttribute('x', '20');
textNode.setAttribute('y', '35');
textNode.setAttribute('font-size', '12');
textNode.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
textNode.appendChild(document.createTextNode(' synthetic 12.5 < 20 & stable '));
span = svg_element(document, 'tspan');
span.setAttribute('dy', '2');
span.appendChild(document.createTextNode(' + 2'));
textNode.appendChild(span);
group.appendChild(textNode);
root.appendChild(group);
end

function element = svg_element(document, name)
element = document.createElementNS('http://www.w3.org/2000/svg', name);
end

function append_stylesheet(document, root)
style = svg_element(document, 'style');
style.appendChild(document.createTextNode(':root > rect { fill: #d7191c; }'));
root.appendChild(style);
end

function assert_metadata(root, target, inches, titleText, description, fontFamily)
assert(strcmp(char(root.getAttribute('width')), sprintf('%dpx', target(1))) ...
    && strcmp(char(root.getAttribute('height')), sprintf('%dpx', target(2))));
assert(str2double(char(root.getAttribute('data-physical-width-in'))) == inches(1) ...
    && str2double(char(root.getAttribute('data-physical-height-in'))) == inches(2));
assert(strcmp(char(root.getAttribute('role')), 'img'));
assert(strcmp(char(root.getAttribute('aria-label')), char(description)));
children = element_children(root);
assert(numel(children) >= 2 && strcmp(char(children{1}.getNodeName()), 'title') ...
    && strcmp(char(children{2}.getNodeName()), 'desc'));
assert(root.getElementsByTagName('title').getLength() == 1 ...
    && root.getElementsByTagName('desc').getLength() == 1);
assert(strcmp(char(children{1}.getTextContent()), char(titleText)) ...
    && strcmp(char(children{2}.getTextContent()), char(description)));
style = char(root.getAttribute('style'));
assert(effective_style(style, 'width') == string(sprintf('%.17gin', inches(1))) ...
    && effective_style(style, 'height') == string(sprintf('%.17gin', inches(2))));
assert(effective_style(style, 'font-family') == fontFamily ...
    && effective_style(style, 'font-size') == "12px" ...
    && effective_style(style, 'stroke-linecap') == "round" ...
    && effective_style(style, 'fill') == "#182c33");
end

function value = effective_style(style, property)
tokens = regexp(style, ['(?:^|;)\s*' property '\s*:\s*([^;]+)'], 'tokens');
assert(~isempty(tokens), "test_svg_viewport_normalization:MissingStyle", ...
    "Missing synthetic style property: %s", property);
value = strtrim(string(tokens{end}{1}));
end

function values = read_viewbox(element)
values = sscanf(char(element.getAttribute('viewBox')), '%f')';
assert(numel(values) == 4 && all(isfinite(values)) && all(values(3:4) > 0));
end

function elements = element_children(parent)
elements = {};
children = parent.getChildNodes();
for childIndex = 0:children.getLength() - 1
    child = children.item(childIndex);
    if child.getNodeType() == 1
        elements{end + 1} = child;
    end
end
end

function signature = payload_signature(parent, ignoreMetadata)
snapshots = {};
children = parent.getChildNodes();
for childIndex = 0:children.getLength() - 1
    child = children.item(childIndex);
    if ignoreMetadata && any(strcmp(char(child.getNodeName()), {'title', 'desc'}))
        continue;
    end
    if meaningful_node(child, parent)
        snapshots{end + 1} = node_snapshot(child);
    end
end
signature = string(jsonencode(snapshots));
end

function snapshot = node_snapshot(node)
attributeRows = cell(0, 3);
if node.getNodeType() == 1
    attributes = node.getAttributes();
    attributeRows = cell(attributes.getLength(), 3);
    for attributeIndex = 0:attributes.getLength() - 1
        attribute = attributes.item(attributeIndex);
        attributeRows(attributeIndex + 1, :) = {char(attribute.getNamespaceURI()), ...
            char(attribute.getNodeName()), char(attribute.getNodeValue())};
    end
    attributeRows = sortrows(attributeRows, [1 2]);
end
childSnapshots = {};
children = node.getChildNodes();
for childIndex = 0:children.getLength() - 1
    child = children.item(childIndex);
    if meaningful_node(child, node)
        childSnapshots{end + 1} = node_snapshot(child);
    end
end
snapshot = struct("type", double(node.getNodeType()), "name", char(node.getNodeName()), ...
    "namespace", char(node.getNamespaceURI()), "value", char(node.getNodeValue()), ...
    "attributes", {attributeRows}, "children", {childSnapshots});
end

function meaningful = meaningful_node(node, parent)
meaningful = true;
if node.getNodeType() == 3
    isTextContainer = any(strcmp(char(parent.getNodeName()), {'text', 'tspan'}));
    meaningful = isTextContainer || ~isempty(strtrim(char(node.getNodeValue())));
end
end
