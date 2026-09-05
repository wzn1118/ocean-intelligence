function test_svg_metadata()
temporaryDirectory = string(tempname);
mkdir(temporaryDirectory);
cleanup = onCleanup(@() rmdir(temporaryDirectory, "s"));
path = fullfile(temporaryDirectory, "native.svg");
document = com.mathworks.xml.XMLUtils.createDocument('svg');
root = document.getDocumentElement();
implementation = document.getImplementation();
documentType = implementation.createDocumentType('svg', '', '');
document.insertBefore(documentType, root);
root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
root.setAttribute('width', '384pt');
root.setAttribute('height', '240pt');
root.setAttribute('viewBox', '10 20 384 240');
root.setAttribute('style', 'stroke-linecap:round');
rectangle = document.createElement('rect');
rectangle.setAttribute('x', '10');
rectangle.setAttribute('y', '20');
rectangle.setAttribute('width', '384');
rectangle.setAttribute('height', '240');
root.appendChild(rectangle);
xmlwrite(char(path), document);
titleText = "Temperature < 20 & salinity > 30";
description = "Source: ""synthetic""; no observations";
for iteration = 1:2
    bounds = oi_annotate_svg(path, titleText, description, 576, 360, 2400, 1500);
    assert(isequal(bounds, [10 20 384 240]));
    verified = xmlread(char(path));
    assert(isempty(verified.getDoctype()));
    result = verified.getDocumentElement();
    assert(strcmp(char(result.getAttribute('viewBox')), '10 20 384 240'));
    assert(strcmp(char(result.getAttribute('width')), '2400px'));
    assert(strcmp(char(result.getAttribute('height')), '1500px'));
    assert(contains(string(result.getAttribute('style')), "stroke-linecap:round"));
    assert(strcmp(char(result.getAttribute('aria-label')), char(description)));
    assert(result.getElementsByTagName('title').getLength() == 1);
    assert(result.getElementsByTagName('desc').getLength() == 1);
    assert(strcmp(char(result.getElementsByTagName('title').item(0).getTextContent()), char(titleText)));
    assert(strcmp(char(result.getElementsByTagName('rect').item(0).getAttribute('x')), '10'));
end
result.removeAttribute('viewBox');
result.setAttribute('width', '384pt');
result.setAttribute('height', '240pt');
xmlwrite(char(path), verified);
bounds = oi_annotate_svg(path, titleText, description, 576, 360, 2400, 1500);
assert(isequal(bounds, [0 0 384 240]));
clear cleanup;
fprintf("MATLAB_SVG_METADATA=passed\n");
end
