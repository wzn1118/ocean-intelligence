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
    viewBox = sscanf(char(replace(originalViewBox, ",", " ")), '%f')';
else
    viewBox = [0 0 native_length(root, 'width') native_length(root, 'height')];
    root.setAttribute('viewBox', sprintf('%.17g %.17g %.17g %.17g', viewBox));
end
assert(numel(viewBox) == 4 && all(isfinite(viewBox)) && all(viewBox(3:4) > 0), ...
    "oi_annotate_svg:InvalidViewBox", "SVG viewBox must have four finite coordinates and positive extents");
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

function value = native_length(root, name)
token = regexp(strtrim(char(root.getAttribute(name))), ...
    '^([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:px|pt)?$', 'tokens', 'once');
assert(~isempty(token), "oi_annotate_svg:InvalidViewBox", ...
    "SVG without a viewBox requires numeric native width and height");
value = str2double(token{1});
end
