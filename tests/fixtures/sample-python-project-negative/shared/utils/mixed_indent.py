"""Utility with mixed indentation styles."""


# VIOLATION: style/deterministic/whitespace-formatting
def process_data(items):
    """Process a list of data items."""
    result = []
    for item in items:
        result.append(item)
    return result


def transform_values(values):
	"""Transform values with tab indentation."""
	output = []
	for v in values:
		output.append(v * 2)
	return output
