"""
Export trained networks to the weights file you upload (football-ai-v1).

PyTorch (nn.Sequential made only of nn.Linear + nn.Tanh/nn.ReLU, input 33, output 3):
    from export_weights import export_torch
    export_torch([net_agent0, net_agent1], "my_weights.json")     # or a single net: it controls both cubes

Plain numpy:  each net is a list of (W[out,in], b[out], "tanh"|"relu"|"linear")
    from export_weights import export_numpy
    export_numpy([[(W1, b1, "tanh"), (W2, b2, "tanh")]], "my_weights.json")

Then check it:   node tools/validate.js my_weights.json
Outputs are clamped to [-1, 1] by the game, so a final tanh is the natural choice.
"""
import json

FORMAT = "football-ai-v1"


def export_numpy(nets, path):
    agents = []
    for net in nets:
        layers = []
        for w, b, act in net:
            layers.append({"w": [[float(v) for v in row] for row in w], "b": [float(v) for v in b], "act": act})
        agents.append({"layers": layers})
    with open(path, "w") as f:
        json.dump({"format": FORMAT, "agents": agents}, f)
    return path


def export_torch(models, path):
    import torch.nn as nn
    if not isinstance(models, (list, tuple)):
        models = [models]
    nets = []
    for m in models:
        mods = list(m.children()) if not isinstance(m, nn.Linear) else [m]
        net, i = [], 0
        while i < len(mods):
            lin = mods[i]
            if not isinstance(lin, nn.Linear):
                raise ValueError(f"expected nn.Linear, got {type(lin).__name__}")
            act = "linear"
            if i + 1 < len(mods):
                nxt = mods[i + 1]
                if isinstance(nxt, nn.Tanh):
                    act = "tanh"; i += 1
                elif isinstance(nxt, nn.ReLU):
                    act = "relu"; i += 1
                elif not isinstance(nxt, nn.Linear):
                    raise ValueError(f"unsupported layer {type(nxt).__name__}; use Linear/Tanh/ReLU only")
            net.append((lin.weight.detach().cpu().numpy(), lin.bias.detach().cpu().numpy(), act))
            i += 1
        nets.append(net)
    return export_numpy(nets, path)
