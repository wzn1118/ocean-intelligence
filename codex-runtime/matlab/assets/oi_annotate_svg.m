function viewBox = oi_annotate_svg(svgPath, titleText, description, widthPoints, heightPoints, widthPixels, heightPixels)
arguments
    svgPath (1,1) string
    titleText (1,1) string
    description (1,1) string
    widthPoints (1,1) double {mustBeFinite,mustBePositive}
    heightPoints (1,1) double {mustBeFinite,mustBePositive}
    widthPixels (1,1) double {mustBeInteger,mustBePositive}
    heightPixels (1,1) double {mustBeInteger,mustBePositive}
end
assert(~isempty(which("xmlread")) && ~isempty(which("xmlwrite")), ...
    "oi_annotate_svg:ParserUnavailable", ...
    "SVG metadata requires MATLAB XML parsing and serialization support");
document = xmlread(char(svgPath));
documentType = document.getDoctype();
if ~isempty(documentType)
    document.removeChild(documentType);
end
root = document.getDocumentElement();
assert(strcmp(char(root.getLocalName()), 'svg') ...
    || strcmp(char(root.getNodeName()), 'svg'), ...
    "oi_annotate_svg:InvalidSvg", "SVG export has no svg root element");
originalViewBox = string(char(root.getAttribute('viewBox')));
if strlength(strtrim(originalViewBox)) > 0
    tokens = regexp(strtrim(char(originalViewBox)), '[\s,]+', 'split');
    numericToken = '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$';
    assert(numel(tokens) == 4 && all(cellfun(@(token) ...
        ~isempty(regexp(token, numericToken, 'once')), tokens)), ...
        "oi_annotate_svg:InvalidViewBox", "SVG viewBox must contain exactly four numeric values");
    viewBox = sscanf(char(replace(originalViewBox, ",", " ")), '%f')';
else
    viewBox = [0 0 native_length(root, 'width') native_length(root, 'height')];
    root.setAttribute('viewBox', sprintf('%.17g %.17g %.17g %.17g', viewBox));
end
assert(numel(viewBox) == 4 && all(isfinite(viewBox)) && all(viewBox(3:4) > 0), ...
    "oi_annotate_svg:InvalidViewBox", "SVG viewBox must have four finite coordinates and positive extents");
targetRatio = widthPixels / heightPixels;
if abs(viewBox(3) / viewBox(4) - targetRatio) > 8 * eps(targetRatio)
    validate_normalization_profile(document, root);
    viewport = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    viewport.setAttribute('x', '0');
    viewport.setAttribute('y', '0');
    viewport.setAttribute('width', char(string(widthPixels)));
    viewport.setAttribute('height', char(string(heightPixels)));
    viewport.setAttribute('viewBox', sprintf('%.17g %.17g %.17g %.17g', viewBox));
    viewport.setAttribute('overflow', 'visible');
    viewport.setAttribute('data-native-viewbox', 'true');
    nativeAspect = char(root.getAttribute('preserveAspectRatio'));
    if ~isempty(nativeAspect)
        viewport.setAttribute('preserveAspectRatio', nativeAspect);
    end
    children = root.getChildNodes();
    retainedChildren = cell(1, children.getLength());
    for index = 0:children.getLength() - 1
        retainedChildren{index + 1} = children.item(index);
    end
    for index = 1:numel(retainedChildren)
        child = retainedChildren{index};
        if ~any(strcmp(char(child.getNodeName()), {'title', 'desc'}))
            viewport.appendChild(child);
        end
    end
    root.appendChild(viewport);
    viewBox = [0 0 widthPixels heightPixels];
    root.setAttribute('viewBox', sprintf('%.17g %.17g %.17g %.17g', viewBox));
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    root.setAttribute('data-viewport-normalization', 'nested-native-viewbox-v1');
end
root.setAttribute('width', char(string(widthPixels) + "px"));
root.setAttribute('height', char(string(heightPixels) + "px"));
originalStyle = string(char(root.getAttribute('style')));
root.setAttribute('style', char(originalStyle + compose(";width:%.17gin;height:%.17gin", ...
    widthPoints / 72, heightPoints / 72)));
root.setAttribute('data-physical-width-in', char(compose("%.17g", widthPoints / 72)));
root.setAttribute('data-physical-height-in', char(compose("%.17g", heightPoints / 72)));
root.setAttribute('role', 'img');
root.setAttribute('aria-label', char(description));
children = root.getChildNodes();
for index = children.getLength() - 1:-1:0
    child = children.item(index);
    if any(strcmp(char(child.getNodeName()), {'title', 'desc'}))
        root.removeChild(child);
    end
end
titleNode = document.createElementNS('http://www.w3.org/2000/svg', 'title');
titleNode.appendChild(document.createTextNode(char(titleText)));
descriptionNode = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
descriptionNode.appendChild(document.createTextNode(char(description)));
root.insertBefore(descriptionNode, root.getFirstChild());
root.insertBefore(titleNode, descriptionNode);
xmlwrite(char(svgPath), document);
verifiedDocument = xmlread(char(svgPath));
verifiedRoot = verifiedDocument.getDocumentElement();
assert(strcmp(char(verifiedRoot.getAttribute('width')), char(string(widthPixels) + "px")) ...
    && strcmp(char(verifiedRoot.getAttribute('height')), char(string(heightPixels) + "px")), ...
    "oi_annotate_svg:Serialization", "SVG output dimensions did not survive XML serialization");
end

function validate_normalization_profile(document, root)
validate_document_nodes(document);
nativeAspect = strtrim(char(root.getAttribute('preserveAspectRatio')));
assert(isempty(nativeAspect) || strcmp(nativeAspect, 'xMidYMid meet'), ...
    "oi_annotate_svg:UnsupportedNormalization", ...
    "SVG viewport normalization requires the native centered meet mapping");
elements = root.getElementsByTagName('*');
validate_element(root, true, root);
for index = 0:elements.getLength() - 1
    validate_element(elements.item(index), false, root);
end
end

function validate_document_nodes(node)
assert(any(node.getNodeType() == [1 3 4 8 9]), ...
    "oi_annotate_svg:UnsupportedNormalization", ...
    "SVG viewport normalization does not support processing instructions or declarations");
children = node.getChildNodes();
for index = 0:children.getLength() - 1
    validate_document_nodes(children.item(index));
end
end

function validate_element(element, isRoot, root)
namespace = char(element.getNamespaceURI());
name = char(element.getNodeName());
allowedElements = {'g', 'defs', 'clipPath', 'rect', 'line', 'path', ...
    'polyline', 'polygon', 'circle', 'ellipse', 'text', 'tspan', 'title', 'desc'};
assert(strcmp(namespace, 'http://www.w3.org/2000/svg') ...
    && (isRoot || any(strcmp(name, allowedElements))), ...
    "oi_annotate_svg:UnsupportedNormalization", ...
    "SVG viewport normalization does not support element %s", name);
presentation = {'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', ...
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', ...
    'stroke-dasharray', 'stroke-dashoffset', 'color', 'color-rendering', ...
    'color-interpolation', 'text-rendering', 'shape-rendering', 'image-rendering', ...
    'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', ...
    'font-variant', 'text-anchor', 'dominant-baseline', 'alignment-baseline', ...
    'letter-spacing', 'word-spacing', 'opacity', 'display', 'visibility'};
rootAttributes = {'width', 'height', 'viewBox', 'preserveAspectRatio', 'version', ...
    'contentScriptType', 'contentStyleType', 'zoomAndPan', 'role', 'aria-label', ...
    'data-physical-width-in', 'data-physical-height-in'};
childAttributes = {'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'width', ...
    'height', 'rx', 'ry', 'cx', 'cy', 'r', 'd', 'points', 'transform', ...
    'clip-path', 'clipPathUnits', 'vector-effect', 'xml:space'};
attributes = element.getAttributes();
for index = 0:attributes.getLength() - 1
    attribute = attributes.item(index);
    attributeName = char(attribute.getNodeName());
    value = char(attribute.getNodeValue());
    if strcmp(attribute.getNamespaceURI(), 'http://www.w3.org/2000/xmlns/')
        continue;
    end
    if strcmp(attributeName, 'style')
        declarations = strsplit(value, ';');
        for declarationIndex = 1:numel(declarations)
            declaration = strtrim(declarations{declarationIndex});
            if isempty(declaration)
                continue;
            end
            tokens = regexp(declaration, '^([a-z-]+)\s*:\s*(.+)$', 'tokens', 'once');
            assert(~isempty(tokens), "oi_annotate_svg:UnsupportedNormalization", ...
                "SVG viewport normalization requires simple inline declarations");
            property = tokens{1};
            allowedProperty = any(strcmp(property, presentation)) ...
                || (isRoot && any(strcmp(property, {'width', 'height'}))) ...
                || (~isRoot && strcmp(property, 'clip-path'));
            assert(allowedProperty, "oi_annotate_svg:UnsupportedNormalization", ...
                "Unsupported SVG inline property: %s", property);
            validate_render_value(property, tokens{2}, root);
        end
    else
        allowedAttribute = any(strcmp(attributeName, [presentation {'id'}])) ...
            || (isRoot && any(strcmp(attributeName, rootAttributes))) ...
            || (~isRoot && any(strcmp(attributeName, childAttributes)));
        assert(allowedAttribute, "oi_annotate_svg:UnsupportedNormalization", ...
            "Unsupported SVG attribute: %s", attributeName);
        if ~any(strcmp(attributeName, {'id', 'role', 'aria-label', ...
                'contentScriptType', 'contentStyleType', 'version', 'zoomAndPan', 'xml:space'}))
            validate_render_value(attributeName, value, root);
        end
    end
end
end

function validate_render_value(name, value, root)
assert(isempty(regexp(lower(value), 'var\s*\(|calc\s*\(|env\s*\(|[{}@!\\]', 'once')), ...
    "oi_annotate_svg:UnsupportedNormalization", ...
    "SVG viewport normalization does not support dynamic or escaped values");
if ~strcmp(name, 'font-family')
    assert(~contains(value, '%') && isempty(regexp(lower(value), ...
        '[0-9.]\s*(em|ex|rem|vh|vw|vmin|vmax|ch)(?:$|[^a-z])', 'once')), ...
        "oi_annotate_svg:UnsupportedNormalization", ...
        "SVG viewport normalization requires absolute rendering values");
end
if contains(lower(value), 'url')
    tokens = regexp(strtrim(value), '^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$', 'tokens', 'once');
    assert(strcmp(name, 'clip-path') && ~isempty(tokens), ...
        "oi_annotate_svg:UnsupportedNormalization", ...
        "SVG viewport normalization only supports local child clip paths");
    clips = root.getElementsByTagName('clipPath');
    matches = 0;
    for index = 0:clips.getLength() - 1
        matches = matches + strcmp(char(clips.item(index).getAttribute('id')), tokens{1});
    end
    assert(matches == 1, "oi_annotate_svg:UnsupportedNormalization", ...
        "SVG clip path must identify exactly one child clipPath");
end
end

function value = native_length(root, name)
token = regexp(strtrim(char(root.getAttribute(name))), ...
    '^([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:px|pt)?$', 'tokens', 'once');
assert(~isempty(token), "oi_annotate_svg:InvalidViewBox", ...
    "SVG without a viewBox requires numeric native width and height");
value = str2double(token{1});
end
